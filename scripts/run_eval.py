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


def write_setup(workspace: Path, files: dict[str, str]) -> None:
    for relative_path, content in files.items():
        target = workspace / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")


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
            record = {
                "id": task["id"],
                "passed": passed,
                "status": result.status,
                "steps": result.steps,
                "duration_seconds": elapsed,
                "tool_errors": tool_errors,
                "final_text": result.final_text,
                "checks": check_results,
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
                f"steps={result.steps} time={elapsed:.2f}s{detail}"
            )
            if result.final_text:
                preview = result.final_text.replace("\n", " ")[:180]
                print(f"       {preview}")

    total = len(records)
    passed_count = sum(1 for record in records if record["passed"])
    average_steps = sum(record["steps"] for record in records) / total
    total_seconds = round(time.perf_counter() - started_all, 2)
    summary = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "provider": model_config.provider,
        "model": model_config.model,
        "passed": passed_count,
        "total": total,
        "success_rate": round(passed_count / total, 4),
        "average_steps": round(average_steps, 2),
        "duration_seconds": total_seconds,
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
