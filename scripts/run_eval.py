from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent.approval import AutoApprove
from agent.config import load_harness_config, load_model_config
from agent.loop import AgentLoop, initial_messages
from agent.trace import EventTracer
from providers.openai_compat import OpenAICompatibleProvider
from tools.builtin import build_registry


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="运行固定 Agent 评测任务")
    parser.add_argument("--tasks", default=str(ROOT / "evals" / "tasks.json"))
    parser.add_argument("--ids", help="逗号分隔的任务 ID")
    parser.add_argument("--limit", type=int, help="最多运行前 N 个任务")
    parser.add_argument("--provider", choices=["local", "cloud"])
    parser.add_argument("--model")
    parser.add_argument("--output", help="结果 JSON 路径")
    return parser.parse_args()


def _render_fixture(spec: str | dict[str, Any]) -> str:
    if isinstance(spec, str):
        return spec
    if not isinstance(spec, dict):
        raise TypeError(f"不支持的 fixture 类型：{type(spec).__name__}")

    repeat_lines = spec.get("repeat_lines", [])
    tail_lines = spec.get("tail_lines", [])
    repeat = spec.get("repeat", 1)
    if not isinstance(repeat_lines, list) or not all(
        isinstance(line, str) for line in repeat_lines
    ):
        raise TypeError("repeat_lines 必须是字符串数组")
    if not isinstance(tail_lines, list) or not all(
        isinstance(line, str) for line in tail_lines
    ):
        raise TypeError("tail_lines 必须是字符串数组")
    if not isinstance(repeat, int) or repeat < 0:
        raise ValueError("repeat 必须是非负整数")

    rendered_lines = repeat_lines * repeat + tail_lines
    if not rendered_lines:
        return ""
    return "\n".join(rendered_lines) + "\n"


def write_setup(workspace: Path, files: dict[str, str | dict[str, Any]]) -> None:
    for relative_path, spec in files.items():
        target = workspace / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(_render_fixture(spec), encoding="utf-8")


def _sum_usage(usages: list[dict[str, Any]], field: str) -> int | None:
    if not usages:
        return None
    return sum(int(usage.get(field, 0)) for usage in usages)


def context_metrics_from_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    responses = [event for event in events if event.get("event") == "model_response"]
    usages = [
        event["usage"]
        for event in responses
        if isinstance(event.get("usage"), dict)
    ]
    turns = []
    for event in responses:
        usage = event.get("usage") if isinstance(event.get("usage"), dict) else None
        turns.append(
            {
                "step": event.get("step"),
                "context_chars": event.get("context_chars"),
                "tool_observation_chars": event.get("tool_observation_chars", 0),
                "input_tokens": usage.get("prompt_tokens") if usage else None,
                "output_tokens": usage.get("completion_tokens") if usage else None,
                "total_tokens": usage.get("total_tokens") if usage else None,
                "context_usage_ratio": event.get("context_usage_ratio"),
            }
        )

    prompt_values = [
        int(usage["prompt_tokens"])
        for usage in usages
        if usage.get("prompt_tokens") is not None
    ]
    ratio_values = [
        float(event["context_usage_ratio"])
        for event in responses
        if event.get("context_usage_ratio") is not None
    ]
    context_values = [
        int(event["context_chars"])
        for event in responses
        if event.get("context_chars") is not None
    ]
    observation_values = [
        int(event.get("tool_observation_chars", 0)) for event in responses
    ]
    return {
        "model_calls": len(responses),
        "usage_calls": len(usages),
        "missing_usage_calls": len(responses) - len(usages),
        "input_tokens": _sum_usage(usages, "prompt_tokens"),
        "output_tokens": _sum_usage(usages, "completion_tokens"),
        "total_tokens": _sum_usage(usages, "total_tokens"),
        "peak_prompt_tokens": max(prompt_values, default=None),
        "peak_context_usage_ratio": max(ratio_values, default=None),
        "peak_context_chars": max(context_values, default=None),
        "peak_tool_observation_chars": max(observation_values, default=0),
        "turns": turns,
    }


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def aggregate_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    input_values = [
        record["context"]["input_tokens"]
        for record in records
        if record["context"]["input_tokens"] is not None
    ]
    output_values = [
        record["context"]["output_tokens"]
        for record in records
        if record["context"]["output_tokens"] is not None
    ]
    total_values = [
        record["context"]["total_tokens"]
        for record in records
        if record["context"]["total_tokens"] is not None
    ]
    peak_chars = [
        record["context"]["peak_context_chars"]
        for record in records
        if record["context"]["peak_context_chars"] is not None
    ]
    peak_prompt = [
        record["context"]["peak_prompt_tokens"]
        for record in records
        if record["context"]["peak_prompt_tokens"] is not None
    ]
    return {
        "usage_available_tasks": len(input_values),
        "total_input_tokens": sum(input_values) if input_values else None,
        "total_output_tokens": sum(output_values) if output_values else None,
        "total_tokens": sum(total_values) if total_values else None,
        "average_input_tokens": _average(input_values),
        "average_output_tokens": _average(output_values),
        "average_peak_context_chars": _average(peak_chars),
        "average_peak_prompt_tokens": _average(peak_prompt),
    }


def group_summaries(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        group = record.get("group")
        if group:
            grouped.setdefault(str(group), []).append(record)

    summaries: dict[str, dict[str, Any]] = {}
    for group, items in sorted(grouped.items()):
        passed = sum(1 for item in items if item["passed"])
        aggregate = aggregate_records(items)
        summaries[group] = {
            "total": len(items),
            "passed": passed,
            "success_rate": round(passed / len(items), 4),
            "average_steps": _average([item["steps"] for item in items]),
            "average_duration_seconds": _average(
                [item["duration_seconds"] for item in items]
            ),
            **aggregate,
        }
    return summaries


def run_check(
    check: dict[str, Any],
    *,
    result,
    events: list[dict],
    workspace: Path,
) -> tuple[bool, str]:
    check_type = check["type"]
    if check_type == "tool_called":
        matched = any(
            event["event"] == "tool_call" and event.get("tool") == check["name"]
            for event in events
        )
        return matched, f"tool_called:{check['name']}"
    if check_type == "tool_succeeded":
        matched = any(
            event["event"] == "tool_result"
            and event.get("tool") == check["name"]
            and event.get("ok", False)
            for event in events
        )
        return matched, f"tool_succeeded:{check['name']}"
    if check_type == "tool_failed":
        matched = any(
            event["event"] == "tool_result"
            and event.get("tool") == check["name"]
            and not event.get("ok", False)
            for event in events
        )
        return matched, f"tool_failed:{check['name']}"
    if check_type == "tool_call_count_at_least":
        count = sum(
            1
            for event in events
            if event["event"] == "tool_call" and event.get("tool") == check["name"]
        )
        return (
            count >= int(check["count"]),
            f"tool_call_count_at_least:{check['name']}:{check['count']}:actual={count}",
        )
    if check_type == "tool_not_called":
        matched = not any(
            event["event"] == "tool_call" and event.get("tool") == check["name"]
            for event in events
        )
        return matched, f"tool_not_called:{check['name']}"
    if check_type == "tool_called_before":
        calls = [
            event.get("tool")
            for event in events
            if event["event"] == "tool_call"
        ]
        first = check["first"]
        second = check["second"]
        first_index = calls.index(first) if first in calls else None
        second_index = calls.index(second) if second in calls else None
        matched = (
            first_index is not None
            and second_index is not None
            and first_index < second_index
        )
        return matched, f"tool_called_before:{first}:{second}"
    if check_type == "output_contains":
        matched = check["text"] in (result.final_text or "")
        return matched, f"output_contains:{check['text']!r}"
    if check_type == "file_exists":
        matched = (workspace / check["path"]).is_file()
        return matched, f"file_exists:{check['path']}"
    if check_type == "file_not_exists":
        matched = not (workspace / check["path"]).exists()
        return matched, f"file_not_exists:{check['path']}"
    if check_type == "file_equals":
        target = workspace / check["path"]
        matched = target.is_file() and target.read_text(encoding="utf-8") == check["text"]
        return matched, f"file_equals:{check['path']}"
    if check_type == "file_contains":
        target = workspace / check["path"]
        matched = target.is_file() and check["text"] in target.read_text(encoding="utf-8")
        return matched, f"file_contains:{check['path']}:{check['text']!r}"
    if check_type == "file_not_contains":
        target = workspace / check["path"]
        matched = target.is_file() and check["text"] not in target.read_text(encoding="utf-8")
        return matched, f"file_not_contains:{check['path']}:{check['text']!r}"
    raise ValueError(f"未知检查类型：{check_type}")


def main() -> int:
    args = parse_args()
    try:
        model_config = load_model_config(provider=args.provider, model=args.model)
        harness_config = load_harness_config()
    except ValueError as exc:
        print(f"配置错误：{exc}")
        return 2

    tasks = json.loads(Path(args.tasks).read_text(encoding="utf-8"))
    if args.ids:
        selected_ids = {item.strip() for item in args.ids.split(",") if item.strip()}
        tasks = [task for task in tasks if task["id"] in selected_ids]
    if args.limit is not None:
        tasks = tasks[: args.limit]
    if not tasks:
        print("没有可运行任务")
        return 2

    provider = OpenAICompatibleProvider(model_config)
    records = []
    started_all = time.perf_counter()

    print(f"模型：{model_config.provider}/{model_config.model}")
    print(f"任务数：{len(tasks)}\n")

    for index, task in enumerate(tasks, start=1):
        started = time.perf_counter()
        with tempfile.TemporaryDirectory(prefix="mini-agent-eval-") as temp_dir:
            workspace = Path(temp_dir) / "workspace"
            workspace.mkdir()
            write_setup(workspace, task.get("setup", {}))

            registry = build_registry(
                workspace,
                max_observation_chars=harness_config.max_observation_chars,
                shell_timeout_seconds=harness_config.shell_timeout_seconds,
                python_timeout_seconds=harness_config.python_timeout_seconds,
            )
            tracer = EventTracer()
            agent = AgentLoop(
                provider,
                registry,
                tracer,
                max_steps=task.get("max_steps", harness_config.max_steps),
                approval_policy=AutoApprove(),
                context_window_tokens=harness_config.context_window_tokens,
            )
            messages = initial_messages()
            messages.append({"role": "user", "content": task["prompt"]})
            result = agent.run(messages)

            check_results = []
            for check in task["checks"]:
                passed, label = run_check(
                    check,
                    result=result,
                    events=tracer.events,
                    workspace=workspace,
                )
                check_results.append({"check": label, "passed": passed})

            passed = result.status == "completed" and all(
                item["passed"] for item in check_results
            )
            elapsed = round(time.perf_counter() - started, 2)
            tool_errors = sum(
                1
                for event in tracer.events
                if event["event"] == "tool_result" and not event.get("ok", False)
            )
            context_metrics = context_metrics_from_events(tracer.events)
            token_summary = "tokens=n/a"
            if context_metrics["input_tokens"] is not None:
                token_summary = (
                    f"tokens={context_metrics['input_tokens']}/"
                    f"{context_metrics['output_tokens']}"
                )
            record = {
                "id": task["id"],
                "group": task.get("group"),
                "passed": passed,
                "status": result.status,
                "steps": result.steps,
                "duration_seconds": elapsed,
                "tool_errors": tool_errors,
                "final_text": result.final_text,
                "checks": check_results,
                "context": context_metrics,
                "events": tracer.events,
            }
            records.append(record)

            mark = "PASS" if passed else "FAIL"
            failed_checks = [
                item["check"] for item in check_results if not item["passed"]
            ]
            detail = "" if passed else f" | failed={failed_checks} | status={result.status}"
            print(
                f"[{index:02d}/{len(tasks):02d}] {mark} {task['id']} "
                f"steps={result.steps} time={elapsed:.2f}s "
                f"context={context_metrics['peak_context_chars']} chars "
                f"{token_summary}{detail}"
            )
            if result.final_text:
                preview = result.final_text.replace("\n", " ")[:180]
                print(f"       {preview}")

    total = len(records)
    passed_count = sum(1 for record in records if record["passed"])
    average_steps = sum(record["steps"] for record in records) / total
    total_seconds = round(time.perf_counter() - started_all, 2)
    aggregate = aggregate_records(records)
    summary = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "provider": model_config.provider,
        "model": model_config.model,
        "context_window_tokens": harness_config.context_window_tokens,
        "max_observation_chars": harness_config.max_observation_chars,
        "passed": passed_count,
        "total": total,
        "success_rate": round(passed_count / total, 4),
        "average_steps": round(average_steps, 2),
        "duration_seconds": total_seconds,
        **aggregate,
        "groups": group_summaries(records),
        "records": records,
    }

    output_path = (
        Path(args.output)
        if args.output
        else ROOT
        / "evals"
        / "results"
        / f"eval-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )

    print(
        f"\n结果：{passed_count}/{total} 通过，成功率 "
        f"{summary['success_rate']:.0%}，平均 {average_steps:.2f} 步，"
        f"总耗时 {total_seconds:.2f}s"
    )
    print(f"报告：{output_path}")
    return 0 if passed_count == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
