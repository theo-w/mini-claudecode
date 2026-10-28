from __future__ import annotations

import argparse
import copy
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent.anatomy import build_catalog
from tools.builtin import build_registry


SUMMARY_KEYS = (
    "passed",
    "total",
    "success_rate",
    "average_steps",
    "duration_seconds",
    "usage_available_tasks",
    "total_input_tokens",
    "total_output_tokens",
    "total_tokens",
    "total_model_input_tokens",
    "total_model_output_tokens",
    "total_model_tokens",
    "total_compactions",
    "total_compaction_fallbacks",
    "average_input_tokens",
    "average_output_tokens",
    "average_peak_context_chars",
    "average_peak_prompt_tokens",
)
RECORD_KEYS = (
    "id",
    "group",
    "passed",
    "status",
    "steps",
    "duration_seconds",
    "tool_errors",
    "final_text",
    "checks",
    "context",
)
SENSITIVE_KEYS = {"apikey", "authorization", "password", "privatekey", "secret"}
TOOL_REQUEST_EVENTS = {"tool_call", "invalid_tool_arguments", "approval_denied"}


def _clean(value: Any, max_content_chars: int) -> Any:
    if isinstance(value, str):
        if len(value) <= max_content_chars:
            return value
        omitted = len(value) - max_content_chars
        return value[:max_content_chars] + f"…[truncated {omitted} chars]"
    if isinstance(value, list):
        return [_clean(item, max_content_chars) for item in value]
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            normalized_key = str(key).lower().replace("_", "").replace("-", "")
            if normalized_key in SENSITIVE_KEYS:
                continue
            cleaned[str(key)] = _clean(item, max_content_chars)
        return cleaned
    return value


def _line_count(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    return len(value.splitlines())


def _list_count(value: Any) -> int:
    return len(value) if isinstance(value, list) else 0


def summarize_fixture(value: Any) -> dict[str, Any]:
    """Describe a fixture without exporting its body."""

    if isinstance(value, str):
        return {
            "kind": "text",
            "line_count": _line_count(value),
        }

    if not isinstance(value, dict):
        return {
            "kind": "unknown",
            "line_count": None,
        }

    if "repeat_lines" in value:
        repeat = value.get("repeat")
        if not isinstance(repeat, int) or isinstance(repeat, bool) or repeat < 0:
            raise ValueError("fixture repeat 必须是非负整数")
        head_lines = _list_count(value.get("head_lines"))
        repeat_lines = _list_count(value.get("repeat_lines"))
        tail_lines = _list_count(value.get("tail_lines"))
        return {
            "kind": "repeated",
            "line_count": head_lines + repeat_lines * repeat + tail_lines,
            "head_lines": head_lines,
            "repeat_lines": repeat_lines,
            "repeat": repeat,
            "tail_lines": tail_lines,
        }

    return {
        "kind": "structured",
        "line_count": None,
    }


def _task_contract(raw: dict[str, Any], *, max_content_chars: int) -> dict[str, Any]:
    task_id = raw.get("id")
    if not isinstance(task_id, str) or not task_id.strip():
        raise ValueError("任务缺少非空 id")
    setup = raw.get("setup") or {}
    if not isinstance(setup, dict):
        raise ValueError(f"任务 {task_id} 的 setup 必须是 object")
    checks = raw.get("checks") or []
    if not isinstance(checks, list):
        raise ValueError(f"任务 {task_id} 的 checks 必须是 array")
    fixtures = []
    for path in sorted(setup):
        if not isinstance(path, str):
            raise ValueError(f"任务 {task_id} 的 fixture path 必须是字符串")
        fixtures.append(
            {
                "path": path,
                **summarize_fixture(setup[path]),
            }
        )
    return {
        "id": task_id,
        "group": raw.get("group"),
        "tags": _clean(raw.get("tags") or [], max_content_chars),
        "prompt": _clean(raw.get("prompt") or "", max_content_chars),
        "checks": _clean(checks, max_content_chars),
        "max_steps": raw.get("max_steps"),
        "fixtures": fixtures,
    }


def merge_task_contracts(contracts: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Merge contracts by ID; identical duplicates are harmless."""

    merged: dict[str, dict[str, Any]] = {}
    canonical: dict[str, str] = {}
    for contract in contracts:
        if not isinstance(contract, dict):
            raise ValueError("task contract 必须是 object")
        task_id = contract.get("id")
        if not isinstance(task_id, str) or not task_id:
            raise ValueError("task contract 缺少非空 id")
        encoded = json.dumps(contract, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if task_id in merged and canonical[task_id] != encoded:
            raise ValueError(f"task contract 冲突：{task_id}")
        merged[task_id] = copy.deepcopy(contract)
        canonical[task_id] = encoded
    return merged


def load_task_contracts(
    paths: Iterable[str | Path],
    *,
    max_content_chars: int = 6000,
) -> dict[str, dict[str, Any]]:
    """Load task files explicitly; never infer them from report paths."""

    contracts: list[dict[str, Any]] = []
    for path in paths:
        task_path = Path(path)
        payload = json.loads(task_path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            payload = payload.get("tasks")
        if not isinstance(payload, list):
            raise ValueError(f"任务文件必须包含数组：{task_path.name}")
        for raw in payload:
            if not isinstance(raw, dict):
                raise ValueError(f"任务文件必须包含 object：{task_path.name}")
            contracts.append(_task_contract(raw, max_content_chars=max_content_chars))
    return merge_task_contracts(contracts)


def _arguments_equal(left: Any, right: Any) -> bool:
    if left == right:
        return True

    def parse(value: Any) -> Any:
        if not isinstance(value, str):
            return value
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return value

    return parse(left) == parse(right)


def link_tool_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add call correlation without changing the source events.

    Current traces carry call_id directly. For legacy reports, model_response
    tool_calls provide the id; calls are matched by step, name and arguments.
    Results use the oldest still-open invocation in their original event order.
    """

    linked = copy.deepcopy(events)
    candidates: list[dict[str, Any]] = []
    open_invocations: list[dict[str, Any]] = []

    for event in linked:
        event_type = event.get("event")
        if event_type == "model_response":
            for call in event.get("tool_calls") or []:
                candidates.append(
                    {
                        "id": call.get("id"),
                        "step": event.get("step"),
                        "tool": call.get("name"),
                        "arguments": call.get("arguments"),
                        "used": False,
                    }
                )
            continue

        if event_type in TOOL_REQUEST_EVENTS:
            call_id = event.get("call_id")
            source = "recorded" if call_id else None
            match = None
            if call_id:
                match = next(
                    (
                        candidate
                        for candidate in candidates
                        if candidate["id"] == call_id and not candidate["used"]
                    ),
                    None,
                )
            else:
                match = next(
                    (
                        candidate
                        for candidate in candidates
                        if not candidate["used"]
                        and candidate["step"] == event.get("step")
                        and candidate["tool"] == event.get("tool")
                        and _arguments_equal(candidate["arguments"], event.get("arguments"))
                    ),
                    None,
                )
                if match and match.get("id"):
                    call_id = match["id"]
                    source = "inferred"
            if match:
                match["used"] = True
            event["call_id"] = call_id
            event["call_id_source"] = source or "unavailable"
            if event_type == "tool_call":
                open_invocations.append(
                    {
                        "call_id": call_id,
                        "step": event.get("step"),
                        "tool": event.get("tool"),
                    }
                )
            continue

        if event_type == "tool_result":
            call_id = event.get("call_id")
            source = "recorded" if call_id else None
            invocation = None
            if call_id:
                invocation = next(
                    (
                        item
                        for item in open_invocations
                        if item["call_id"] == call_id
                    ),
                    None,
                )
            else:
                invocation = next(
                    (
                        item
                        for item in open_invocations
                        if item["step"] == event.get("step")
                        and item["tool"] == event.get("tool")
                    ),
                    None,
                )
                if invocation:
                    call_id = invocation.get("call_id")
                    source = "inferred" if call_id else "unavailable"
            if invocation:
                open_invocations.remove(invocation)
            event["call_id"] = call_id
            event["call_id_source"] = source or "unavailable"

    return linked


def load_report(
    path: str | Path,
    label: str,
    *,
    max_content_chars: int = 6000,
) -> dict[str, Any]:
    if max_content_chars < 1:
        raise ValueError("max_content_chars 必须大于 0")
    report_path = Path(path)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if not isinstance(report, dict) or not isinstance(report.get("records"), list):
        raise ValueError(f"报告缺少 records 数组：{report_path.name}")

    records = []
    for raw_record in report["records"]:
        if not isinstance(raw_record, dict):
            raise ValueError(f"报告 records 必须包含 object：{report_path.name}")
        record = {
            key: _clean(raw_record.get(key), max_content_chars)
            for key in RECORD_KEYS
        }
        raw_events = raw_record.get("events") or []
        cleaned_events = _clean(raw_events, max_content_chars)
        record["events"] = []
        for sequence, event in enumerate(link_tool_events(cleaned_events)):
            event["sequence"] = sequence
            record["events"].append(event)
        records.append(record)

    compaction = _clean(report.get("compaction") or {}, max_content_chars)
    return {
        "id": label,
        "label": label,
        "source_name": report_path.name,
        "timestamp": report.get("timestamp"),
        "provider": report.get("provider"),
        "model": report.get("model"),
        "code_revision": report.get("code_revision"),
        "config": {
            "context_window_tokens": report.get("context_window_tokens"),
            "max_observation_chars": report.get("max_observation_chars"),
            "compaction": compaction,
        },
        "summary": {
            key: _clean(report.get(key), max_content_chars)
            for key in SUMMARY_KEYS
        },
        "groups": _clean(report.get("groups") or {}, max_content_chars),
        "records": records,
    }


def build_dashboard_data(
    runs: Iterable[dict[str, Any]],
    registry,
    *,
    generated_at: str | None = None,
    task_contracts: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    run_list = list(runs)
    labels = [run.get("label") for run in run_list]
    if len(labels) != len(set(labels)):
        raise ValueError("Dashboard run label 必须唯一")
    data = {
        "schema_version": 1,
        "generated_at": generated_at or datetime.now(timezone.utc).isoformat(),
        "data_classification": "local-unredacted",
        "catalog": build_catalog(registry),
        "runs": run_list,
    }
    if task_contracts is not None:
        data["task_contracts"] = task_contracts
    return data


def export_dashboard(
    report_entries: list[tuple[Path, str]],
    output: Path,
    *,
    task_paths: Iterable[str | Path] | None = None,
    max_content_chars: int = 6000,
) -> dict[str, Any]:
    runs = [
        load_report(path, label, max_content_chars=max_content_chars)
        for path, label in report_entries
    ]
    task_contracts = (
        load_task_contracts(task_paths, max_content_chars=max_content_chars)
        if task_paths is not None
        else None
    )
    data = build_dashboard_data(
        runs,
        build_registry(ROOT),
        task_contracts=task_contracts,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="将现有 Eval JSON 导出为本地 Agent Anatomy 数据；不会运行模型或工具。"
    )
    parser.add_argument("reports", nargs="+", type=Path, help="一份或多份 Eval JSON")
    parser.add_argument("--labels", nargs="+", help="与 reports 一一对应的显示名称")
    parser.add_argument(
        "--tasks",
        action="append",
        type=Path,
        default=[],
        metavar="PATH",
        help="任务集 JSON；可重复传入，按 task id 合并",
    )
    parser.add_argument("--output", type=Path, default=ROOT / "dashboard" / "data.json")
    parser.add_argument("--max-content-chars", type=int, default=6000)
    args = parser.parse_args(argv)

    if args.labels is not None and len(args.labels) != len(args.reports):
        parser.error("--labels 数量必须与 reports 一致")
    if args.max_content_chars < 1:
        parser.error("--max-content-chars 必须大于 0")

    labels = args.labels or [path.stem for path in args.reports]
    if len(labels) != len(set(labels)):
        parser.error("run label 必须唯一，请使用 --labels 指定不同名称")

    try:
        entries = list(zip(args.reports, labels))
        data = export_dashboard(
            entries,
            args.output,
            task_paths=args.tasks or None,
            max_content_chars=args.max_content_chars,
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.exit(2, f"导出失败：{exc}\n")

    task_count = sum(len(run["records"]) for run in data["runs"])
    contract_count = len(data.get("task_contracts") or {})
    print(
        f"已导出 {len(data['runs'])} 次运行、{task_count} 条任务记录、"
        f"{len(data['catalog']['tools'])} 个工具、{contract_count} 份任务契约到 {args.output}"
    )
    print("数据分类：local-unredacted。字符截断不是脱敏，请勿直接公开分享。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
