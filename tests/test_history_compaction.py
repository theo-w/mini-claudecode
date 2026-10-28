from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from agent.compaction import (
    CompactionConfig,
    HistoryCompactor,
    validate_tool_protocol,
)
from agent.config import load_harness_config
from agent.loop import AgentLoop, initial_messages
from agent.models import AssistantTurn, TokenUsage, ToolCall
from agent.trace import EventTracer
from scripts.run_eval import aggregate_records, context_metrics_from_events, run_check
from tools.builtin import build_registry


class RecordingProvider:
    def __init__(self, turns: list[AssistantTurn]) -> None:
        self.turns = list(turns)
        self.calls: list[dict] = []

    def complete(self, messages: list[dict], tools: list[dict]) -> AssistantTurn:
        self.calls.append({"messages": messages, "tools": tools})
        if not self.turns:
            raise AssertionError("没有剩余脚本响应")
        return self.turns.pop(0)


class SummaryProvider:
    def __init__(self, turn: AssistantTurn | None = None, error: Exception | None = None) -> None:
        self.turn = turn
        self.error = error
        self.calls: list[dict] = []

    def complete(self, messages: list[dict], tools: list[dict]) -> AssistantTurn:
        self.calls.append({"messages": messages, "tools": tools})
        if self.error is not None:
            raise self.error
        if self.turn is None:
            raise AssertionError("缺少摘要响应")
        return self.turn


def _tool_call(call_id: str, name: str, arguments: dict) -> ToolCall:
    return ToolCall(id=call_id, name=name, arguments=json.dumps(arguments))


def _assistant_tool(call_id: str, name: str, arguments: dict) -> dict:
    call = _tool_call(call_id, name, arguments)
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": call.id,
                "type": "function",
                "function": {"name": call.name, "arguments": call.arguments},
            }
        ],
    }


def _tool_message(call_id: str, content: str) -> dict:
    return {"role": "tool", "tool_call_id": call_id, "content": content}


def _base_messages() -> list[dict]:
    return [
        {"role": "system", "content": "SYSTEM"},
        {
            "role": "user",
            "content": "读取 audits.log，找到 ACCESS_CODE；同时保留 ERROR 和 TODO。",
        },
        _assistant_tool("call-read", "read_file", {"file_path": "audits.log"}),
        _tool_message(
            "call-read",
            "total_lines: 200\nreturned_range: 1-40\nhas_more: true\n"
            "next_start_line: 41\nfile_has_more: true\n---\n"
            "     1\tnoise alpha\n"
            "     2\tnoise beta\n"
            + "\n".join(f"    {line}\tnoise filler {line}" for line in range(3, 80))
            + "\n"
            "   130\tACCESS_CODE: ORBIT-7319\n"
            "   131\tTODO: verify orbit checksum\n"
            "   132\tERROR: calibration validation failed",
        ),
        _assistant_tool("call-missing", "read_file", {"file_path": "missing.log"}),
        _tool_message("call-missing", "ERROR: 文件不存在：missing.log"),
        {"role": "assistant", "content": "我会继续验证。"},
    ]


class HistoryCompactionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.workspace = Path(self.temp_dir.name) / "workspace"
        self.workspace.mkdir()
        self.events: list[dict] = []

    def record(self, event: str, **data) -> None:
        self.events.append({"event": event, **data})

    def compactor(self, **overrides) -> HistoryCompactor:
        config = {
            "strategy": "extractive",
            "trigger_tokens": 700,
            "keep_recent_messages": 2,
            "max_summary_chars": 900,
        }
        config.update(overrides)
        return HistoryCompactor(CompactionConfig(**config))

    def test_extractive_summary_preserves_evidence(self) -> None:
        messages = _base_messages()

        result = self.compactor(keep_recent_messages=1).compact(
            messages,
            provider=None,
            record=self.record,
            step=3,
            prompt_tokens=900,
        )

        summary = messages[1]["content"]
        self.assertTrue(result.compacted)
        self.assertIn("audits.log", summary)
        self.assertIn("line=130", summary)
        self.assertIn("ACCESS_CODE: ORBIT-7319", summary)
        self.assertIn("TODO: verify orbit checksum", summary)
        self.assertIn("ERROR: calibration validation failed", summary)
        self.assertIn("missing.log", summary)
        self.assertIn("文件不存在", summary)
        self.assertIn("next_start_line=41", summary)
        self.assertIn("file_has_more=true", summary)
        self.assertNotIn("noise alpha", summary)
        self.assertGreaterEqual(result.evidence_count, 3)

    def test_compaction_preserves_anchors_and_bounds_summary(self) -> None:
        messages = _base_messages()
        latest_user = messages[1]["content"]
        system = messages[0]["content"]

        result = self.compactor(max_summary_chars=320).compact(
            messages,
            provider=None,
            record=self.record,
            step=2,
            prompt_tokens=800,
        )

        self.assertTrue(result.compacted)
        self.assertEqual(messages[0], {"role": "system", "content": system})
        self.assertEqual(messages[1]["role"], "system")
        self.assertIn("[COMPACTED_HISTORY_V1", messages[1]["content"])
        self.assertLessEqual(len(messages[1]["content"]), 320)
        self.assertEqual(messages[2], {"role": "user", "content": latest_user})
        self.assertLess(len(messages), len(_base_messages()))
        self.assertTrue(validate_tool_protocol(messages)[0])

    def test_compaction_preserves_tool_protocol(self) -> None:
        messages = [
            {"role": "system", "content": "SYSTEM"},
            {"role": "user", "content": "检查文件"},
            _assistant_tool("old", "read_file", {"file_path": "old.txt"}),
            _tool_message(
                "old",
                "\n".join(f"{line}\told evidence {line}" for line in range(1, 60)),
            ),
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "recent-a",
                        "type": "function",
                        "function": {"name": "read_file", "arguments": '{"file_path":"a.txt"}'},
                    },
                    {
                        "id": "recent-b",
                        "type": "function",
                        "function": {"name": "read_file", "arguments": '{"file_path":"b.txt"}'},
                    },
                ],
            },
            _tool_message("recent-a", "A"),
            _tool_message("recent-b", "B"),
        ]

        HistoryCompactor(
            CompactionConfig(
                strategy="extractive",
                trigger_tokens=10,
                keep_recent_messages=1,
                max_summary_chars=500,
            )
        ).compact(
            messages,
            provider=None,
            record=self.record,
            step=2,
            prompt_tokens=20,
        )

        valid, reason = validate_tool_protocol(messages)
        self.assertTrue(valid, reason)
        recent_assistant = next(
            message
            for message in messages
            if message.get("role") == "assistant" and message.get("tool_calls")
        )
        retained_ids = {call["id"] for call in recent_assistant["tool_calls"]}
        retained_tool_ids = {
            message["tool_call_id"]
            for message in messages
            if message.get("role") == "tool"
        }
        self.assertEqual(retained_ids, {"recent-a", "recent-b"})
        self.assertEqual(retained_tool_ids, {"recent-a", "recent-b"})

    def test_model_summary_records_usage(self) -> None:
        provider = SummaryProvider(
            AssistantTurn(
                content=(
                    "read_file 读取了 audits.log 和 missing.log。"
                    "audits.log：line=130 ACCESS_CODE: ORBIT-7319；"
                    "line=131 TODO: verify orbit checksum；"
                    "line=132 ERROR: calibration validation failed；"
                    "returned_range=1-40；next_start_line=41；"
                    "has_more=true；file_has_more=true。"
                    "missing.log：ERROR: 文件不存在：missing.log。"
                ),
                usage=TokenUsage(prompt_tokens=500, completion_tokens=20, total_tokens=520),
            )
        )
        messages = _base_messages()

        result = self.compactor(
            strategy="model",
            keep_recent_messages=1,
            max_summary_chars=1400,
        ).compact(
            messages,
            provider=provider,
            record=self.record,
            step=4,
            prompt_tokens=950,
        )

        self.assertTrue(result.compacted)
        self.assertEqual(result.effective_strategy, "model")
        self.assertIsNone(result.fallback_reason)
        self.assertEqual(result.summary_usage["total_tokens"], 520)
        self.assertEqual(provider.calls[0]["tools"], [])
        self.assertIn("ORBIT-7319", messages[1]["content"])
        event_names = [event["event"] for event in self.events]
        self.assertIn("compaction_model_request", event_names)
        self.assertIn("compaction_model_response", event_names)

    def test_model_summary_fallback_on_missing_evidence(self) -> None:
        messages = _base_messages()

        result = self.compactor(
            strategy="model",
            keep_recent_messages=1,
            max_summary_chars=1400,
        ).compact(
            messages,
            provider=SummaryProvider(
                AssistantTurn(content="ACCESS_CODE: ORBIT-7319")
            ),
            record=self.record,
            step=4,
            prompt_tokens=950,
        )

        self.assertTrue(result.compacted)
        self.assertEqual(result.effective_strategy, "extractive")
        self.assertIn("missing_required_evidence", result.fallback_reason or "")
        self.assertIn("ACCESS_CODE: ORBIT-7319", messages[1]["content"])

    def test_model_summary_requires_every_metadata_fact(self) -> None:
        messages = _base_messages()
        provider = SummaryProvider(
            AssistantTurn(
                content=(
                    "read_file 读取了 audits.log 和 missing.log。"
                    "audits.log：line=130 ACCESS_CODE: ORBIT-7319；"
                    "line=131 TODO: verify orbit checksum；"
                    "line=132 ERROR: calibration validation failed；"
                    "returned_range=1-40；next_start_line=41；has_more=true。"
                    "missing.log：ERROR: 文件不存在：missing.log。"
                )
            )
        )

        result = self.compactor(
            strategy="model",
            keep_recent_messages=1,
            max_summary_chars=1400,
        ).compact(
            messages,
            provider=provider,
            record=self.record,
            step=4,
            prompt_tokens=950,
        )

        self.assertTrue(result.compacted)
        self.assertEqual(result.effective_strategy, "extractive")
        self.assertIn("missing_required_evidence", result.fallback_reason or "")
        self.assertIn("file_has_more=true", result.fallback_reason or "")
        self.assertIn("file_has_more=true", messages[1]["content"])

    def test_model_summary_fallback_on_over_budget(self) -> None:
        messages = _base_messages()
        provider = SummaryProvider(AssistantTurn(content="x" * 1000))

        result = self.compactor(
            strategy="model",
            max_summary_chars=900,
        ).compact(
            messages,
            provider=provider,
            record=self.record,
            step=4,
            prompt_tokens=950,
        )

        self.assertTrue(result.compacted)
        self.assertEqual(result.effective_strategy, "extractive")
        self.assertEqual(result.fallback_reason, "summary_over_budget")

    def test_model_summary_fallback_on_error(self) -> None:
        messages = _base_messages()

        result = self.compactor(strategy="model").compact(
            messages,
            provider=SummaryProvider(error=RuntimeError("summary unavailable")),
            record=self.record,
            step=4,
            prompt_tokens=950,
        )

        self.assertTrue(result.compacted)
        self.assertEqual(result.effective_strategy, "extractive")
        self.assertIn("summary unavailable", result.fallback_reason or "")
        self.assertIn("ORBIT-7319", messages[1]["content"])

    def test_model_summary_fallback_on_empty_or_tool_response(self) -> None:
        for turn in (
            AssistantTurn(content=""),
            AssistantTurn(
                content=None,
                tool_calls=[_tool_call("bad-summary-tool", "read_file", {"file_path": "x"})],
            ),
        ):
            with self.subTest(turn=turn):
                messages = _base_messages()
                result = self.compactor(strategy="model").compact(
                    messages,
                    provider=SummaryProvider(turn),
                    record=self.record,
                    step=4,
                    prompt_tokens=950,
                )
                self.assertTrue(result.compacted)
                self.assertEqual(result.effective_strategy, "extractive")
                self.assertIn("ORBIT-7319", messages[1]["content"])

    def test_repeated_compaction_deduplicates_evidence(self) -> None:
        messages = _base_messages()
        compactor = self.compactor(keep_recent_messages=1, max_summary_chars=1400)
        compactor.compact(
            messages,
            provider=None,
            record=self.record,
            step=2,
            prompt_tokens=900,
        )

        messages.insert(-1, _assistant_tool("new", "read_file", {"file_path": "new.log"}))
        messages.insert(-1, _tool_message("new", "    9\tERROR: new failure"))
        messages.insert(-1, {"role": "assistant", "content": "再次检查。"})
        compactor.compact(
            messages,
            provider=None,
            record=self.record,
            step=4,
            prompt_tokens=1000,
        )

        summaries = [
            message
            for message in messages
            if message.get("role") == "system"
            and "[COMPACTED_HISTORY_V1" in str(message.get("content"))
        ]
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0]["content"].count("ACCESS_CODE: ORBIT-7319"), 1)
        self.assertTrue(validate_tool_protocol(messages)[0])

    def test_recompaction_keeps_context_bullets_out_of_evidence(self) -> None:
        messages = _base_messages()
        compactor = self.compactor(keep_recent_messages=1, max_summary_chars=1400)
        compactor.compact(
            messages,
            provider=None,
            record=self.record,
            step=2,
            prompt_tokens=900,
        )

        messages.insert(-1, {"role": "assistant", "content": "补充一段较长的上下文说明。"})
        compactor.compact(
            messages,
            provider=None,
            record=self.record,
            step=4,
            prompt_tokens=1000,
        )

        summary = next(
            message["content"]
            for message in messages
            if message.get("role") == "system"
            and "[COMPACTED_HISTORY_V1" in str(message.get("content"))
        )
        evidence_section = summary.split("CONTEXT:", 1)[0]
        self.assertNotIn("- [context]", evidence_section)

    def test_does_not_replace_history_with_a_larger_summary(self) -> None:
        messages = [
            {"role": "system", "content": "SYSTEM"},
            {"role": "user", "content": "当前任务"},
            {"role": "assistant", "content": "ok"},
            {"role": "assistant", "content": "最近输出"},
        ]
        before = json.dumps(messages, ensure_ascii=False)

        result = self.compactor(keep_recent_messages=1).compact(
            messages,
            provider=None,
            record=self.record,
            step=2,
            prompt_tokens=900,
        )

        self.assertFalse(result.compacted)
        self.assertEqual(result.reason, "summary_not_smaller")
        self.assertEqual(json.dumps(messages, ensure_ascii=False), before)

    def test_loop_compacts_at_threshold_and_keeps_original_trace(self) -> None:
        (self.workspace / "audits.log").write_text(
            "noise\n" * 20 + "ACCESS_CODE: ORBIT-7319\n" + "tail\n" * 5,
            encoding="utf-8",
        )
        registry = build_registry(self.workspace, max_observation_chars=500)
        tracer = EventTracer()
        provider = RecordingProvider(
            [
                AssistantTurn(
                    content=None,
                    tool_calls=[
                        _tool_call("call-1", "read_file", {"file_path": "audits.log"})
                    ],
                    usage=TokenUsage(prompt_tokens=900, completion_tokens=20, total_tokens=920),
                ),
                AssistantTurn(
                    content=None,
                    tool_calls=[
                        _tool_call(
                            "call-2",
                            "read_file",
                            {"file_path": "audits.log", "start_line": 26},
                        )
                    ],
                    usage=TokenUsage(prompt_tokens=900, completion_tokens=20, total_tokens=920),
                ),
                AssistantTurn(
                    content="ACCESS_CODE 是 ORBIT-7319。",
                    usage=TokenUsage(prompt_tokens=180, completion_tokens=12, total_tokens=192),
                ),
            ]
        )
        agent = AgentLoop(
            provider,
            registry,
            tracer,
            max_steps=4,
            context_window_tokens=1000,
            compaction_strategy="extractive",
            compaction_trigger_tokens=700,
            compaction_keep_recent_messages=2,
            compaction_max_summary_chars=500,
        )
        messages = initial_messages()
        messages.append({"role": "user", "content": "读取 audits.log 并报告 ACCESS_CODE。"})

        result = agent.run(messages)

        self.assertEqual(result.status, "completed")
        compaction_events = [
            event
            for event in tracer.events
            if event["event"] == "history_compaction" and event["compacted"]
        ]
        self.assertEqual(len(compaction_events), 1)
        self.assertEqual(compaction_events[0]["trigger_prompt_tokens"], 900)
        self.assertIn("COMPACTED_HISTORY_V1", provider.calls[2]["messages"][1]["content"])
        tool_results = [
            event for event in tracer.events if event["event"] == "tool_result"
        ]
        self.assertTrue(tool_results)
        self.assertTrue(
            any("ACCESS_CODE: ORBIT-7319" in event["content"] for event in tool_results)
        )

    def test_loop_records_below_threshold_without_compacting(self) -> None:
        (self.workspace / "a.txt").write_text("hello", encoding="utf-8")
        registry = build_registry(self.workspace)
        tracer = EventTracer()
        provider = RecordingProvider(
            [
                AssistantTurn(
                    content=None,
                    tool_calls=[_tool_call("call-1", "read_file", {"file_path": "a.txt"})],
                    usage=TokenUsage(prompt_tokens=699, completion_tokens=10, total_tokens=709),
                ),
                AssistantTurn(content="完成。"),
            ]
        )
        agent = AgentLoop(
            provider,
            registry,
            tracer,
            max_steps=3,
            compaction_strategy="extractive",
            compaction_trigger_tokens=700,
        )
        messages = initial_messages()
        messages.append({"role": "user", "content": "读取 a.txt"})

        result = agent.run(messages)

        self.assertEqual(result.status, "completed")
        events = [event for event in tracer.events if event["event"] == "history_compaction"]
        self.assertEqual(len(events), 1)
        self.assertFalse(events[0]["compacted"])
        self.assertEqual(events[0]["reason"], "below_threshold")
        self.assertNotIn("COMPACTED_HISTORY_V1", json.dumps(provider.calls[1]["messages"]))

    def test_loop_does_not_compact_without_usage(self) -> None:
        (self.workspace / "a.txt").write_text("hello", encoding="utf-8")
        registry = build_registry(self.workspace)
        tracer = EventTracer()
        provider = RecordingProvider(
            [
                AssistantTurn(
                    content=None,
                    tool_calls=[_tool_call("call-1", "read_file", {"file_path": "a.txt"})],
                    usage=None,
                ),
                AssistantTurn(content="完成。"),
            ]
        )
        agent = AgentLoop(
            provider,
            registry,
            tracer,
            max_steps=3,
            compaction_strategy="extractive",
            compaction_trigger_tokens=1,
        )
        messages = initial_messages()
        messages.append({"role": "user", "content": "读取 a.txt"})

        result = agent.run(messages)

        self.assertEqual(result.status, "completed")
        events = [event for event in tracer.events if event["event"] == "history_compaction"]
        self.assertEqual(len(events), 1)
        self.assertFalse(events[0]["compacted"])
        self.assertEqual(events[0]["reason"], "usage_unavailable")
        self.assertNotIn("COMPACTED_HISTORY_V1", json.dumps(provider.calls[1]["messages"]))

    def test_compaction_config_is_validated(self) -> None:
        config = load_harness_config(
            env={
                "COMPACTION_STRATEGY": "extractive",
                "CONTEXT_WINDOW_TOKENS": "4096",
                "COMPACTION_TRIGGER_TOKENS": "2500",
                "COMPACTION_KEEP_RECENT_MESSAGES": "4",
                "COMPACTION_MAX_SUMMARY_CHARS": "1200",
            },
            workspace=self.workspace,
        )
        self.assertEqual(config.compaction_strategy, "extractive")
        self.assertEqual(config.compaction_trigger_tokens, 2500)
        self.assertEqual(config.compaction_keep_recent_messages, 4)
        self.assertEqual(config.compaction_max_summary_chars, 1200)

        for env, message in (
            ({"COMPACTION_STRATEGY": "bad"}, "COMPACTION_STRATEGY"),
            (
                {
                    "COMPACTION_STRATEGY": "extractive",
                    "CONTEXT_WINDOW_TOKENS": "1000",
                    "COMPACTION_TRIGGER_TOKENS": "1001",
                },
                "COMPACTION_TRIGGER_TOKENS",
            ),
            (
                {"COMPACTION_KEEP_RECENT_MESSAGES": "0"},
                "COMPACTION_KEEP_RECENT_MESSAGES",
            ),
            (
                {"COMPACTION_MAX_SUMMARY_CHARS": "20"},
                "COMPACTION_MAX_SUMMARY_CHARS",
            ),
        ):
            with self.subTest(env=env):
                with self.assertRaisesRegex(ValueError, message):
                    load_harness_config(env=env, workspace=self.workspace)

    def test_context_metrics_count_compaction_usage(self) -> None:
        events = [
            {
                "event": "model_response",
                "step": 1,
                "context_chars": 500,
                "tool_observation_chars": 400,
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 10,
                    "total_tokens": 110,
                },
                "context_usage_ratio": 0.1,
            },
            {
                "event": "compaction_model_response",
                "step": 2,
                "usage": {
                    "prompt_tokens": 120,
                    "completion_tokens": 20,
                    "total_tokens": 140,
                },
            },
            {
                "event": "history_compaction",
                "step": 2,
                "compacted": True,
                "context_chars_before": 500,
                "context_chars_after": 180,
                "summary_chars": 120,
                "evidence_count": 4,
                "summary_usage": {
                    "prompt_tokens": 120,
                    "completion_tokens": 20,
                    "total_tokens": 140,
                },
            },
        ]

        metrics = context_metrics_from_events(events)

        self.assertEqual(metrics["main_model_calls"], 1)
        self.assertEqual(metrics["compaction_model_calls"], 1)
        self.assertEqual(metrics["input_tokens"], 100)
        self.assertEqual(metrics["compaction_input_tokens"], 120)
        self.assertEqual(metrics["total_model_input_tokens"], 220)
        self.assertEqual(metrics["compactions"], 1)
        self.assertEqual(metrics["compaction_saved_chars"], 320)
        self.assertEqual(metrics["compaction_evidence_count"], 4)

    def test_aggregate_records_includes_compaction_costs(self) -> None:
        records = [
            {
                "group": "retention",
                "passed": True,
                "steps": 3,
                "duration_seconds": 1.0,
                "context": {
                    "input_tokens": 100,
                    "output_tokens": 10,
                    "total_tokens": 110,
                    "total_model_input_tokens": 150,
                    "total_model_output_tokens": 15,
                    "total_model_tokens": 165,
                    "compaction_input_tokens": 50,
                    "compaction_output_tokens": 5,
                    "compaction_total_tokens": 55,
                    "compactions": 1,
                    "compaction_fallbacks": 0,
                    "peak_context_chars": 500,
                    "peak_prompt_tokens": 120,
                },
            }
        ]

        aggregate = aggregate_records(records)

        self.assertEqual(aggregate["total_model_input_tokens"], 150)
        self.assertEqual(aggregate["total_model_tokens"], 165)
        self.assertEqual(aggregate["total_compactions"], 1)
        self.assertEqual(aggregate["total_compaction_fallbacks"], 0)

    def test_m1_2_task_contract(self) -> None:
        tasks = json.loads(
            (Path(__file__).resolve().parents[1] / "evals" / "m1_2_tasks.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertEqual(len(tasks), 6)
        self.assertEqual(len({task["id"] for task in tasks}), len(tasks))
        self.assertEqual(
            {task.get("group") for task in tasks},
            {"retention", "failure", "todo", "multi_file", "rolling"},
        )
        tags = {tag for task in tasks for tag in task.get("tags", [])}
        self.assertTrue(
            {
                "exact_value",
                "error_original",
                "failed_tool",
                "todo_fixme",
                "multiple_sources",
                "near_window",
                "repeated_compaction",
            }.issubset(tags)
        )

        allowed_checks = {
            "tool_called",
            "tool_succeeded",
            "tool_failed",
            "tool_call_count_at_least",
            "tool_paths_covered",
            "model_call_count_at_least",
            "compaction_count_at_least",
            "tool_not_called",
            "tool_called_before",
            "output_contains",
            "output_contains_normalized",
            "output_equals_normalized",
            "file_exists",
            "file_not_exists",
            "file_equals",
            "file_contains",
            "file_not_contains",
        }
        required_check_keys = {
            "tool_called": {"name"},
            "tool_succeeded": {"name"},
            "tool_failed": {"name"},
            "tool_call_count_at_least": {"name", "count"},
            "tool_paths_covered": {"name", "paths"},
            "model_call_count_at_least": {"count"},
            "compaction_count_at_least": {"count"},
            "tool_not_called": {"name"},
            "tool_called_before": {"first", "second"},
            "output_contains": {"text"},
            "output_contains_normalized": {"text"},
            "output_equals_normalized": {"text"},
            "file_exists": {"path"},
            "file_not_exists": {"path"},
            "file_equals": {"path", "text"},
            "file_contains": {"path", "text"},
            "file_not_contains": {"path", "text"},
        }
        for task in tasks:
            self.assertGreaterEqual(task["max_steps"], 1)
            self.assertTrue(task["prompt"])
            self.assertTrue(task["checks"])
            self.assertIsInstance(task.get("tags"), list)
            for check in task["checks"]:
                self.assertIn(check["type"], allowed_checks)
                self.assertTrue(required_check_keys[check["type"]].issubset(check))
            if any(
                check.get("type") == "tool_call_count_at_least"
                and check.get("name") == "read_file"
                for check in task["checks"]
            ):
                self.assertIn("read_file", task["prompt"])
            for fixture in task.get("setup", {}).values():
                self.assertIsInstance(fixture, (str, dict))

        task_by_tag = {
            tag: next(task for task in tasks if tag in task.get("tags", []))
            for tag in tags
        }
        self.assertIn(
            {
                "type": "tool_call_count_at_least",
                "name": "read_file",
                "count": 2,
            },
            task_by_tag["exact_value"]["checks"],
        )
        self.assertIn(
            {"type": "tool_failed", "name": "read_file"},
            task_by_tag["failed_tool"]["checks"],
        )
        self.assertIn(
            {"type": "tool_not_called", "name": "grep"},
            task_by_tag["todo_fixme"]["checks"],
        )
        self.assertTrue(
            any(
                check.get("type") == "output_contains"
                and check.get("text") == "M12-ALPHA-M12-BETA-M12-GAMMA"
                for check in task_by_tag["multiple_sources"]["checks"]
            )
        )
        self.assertTrue(
            any(
                check.get("type") == "output_equals_normalized"
                and check.get("text") == "K7Q-A19|P2V-D47"
                for check in task_by_tag["near_window"]["checks"]
            )
        )
        self.assertTrue(
            any(
                check.get("type") == "tool_paths_covered"
                and check.get("name") == "read_file"
                and check.get("paths", []) == ["checkpoints-paged.log"]
                for check in task_by_tag["near_window"]["checks"]
            )
        )
        self.assertTrue(
            any(
                check.get("type") == "tool_call_count_at_least"
                and check.get("name") == "read_file"
                and check.get("count") == 10
                for check in task_by_tag["repeated_compaction"]["checks"]
            )
        )
        self.assertTrue(
            any(
                check.get("type") == "tool_paths_covered"
                and check.get("name") == "read_file"
                and check.get("paths", []) == ["retain-paged.log"]
                for check in task_by_tag["repeated_compaction"]["checks"]
            )
        )

    def test_evals_accept_whitespace_variants_and_require_all_paths(self) -> None:
        events = [
            {
                "event": "tool_call",
                "tool": "read_file",
                "arguments": {"file_path": "a.txt"},
            },
            {
                "event": "tool_call",
                "tool": "read_file",
                "arguments": {"file_path": "b.txt"},
            },
        ]
        result = SimpleNamespace(final_text="K7Q-A19 | M4R-B82")

        normalized_passed, normalized_label = run_check(
            {"type": "output_contains_normalized", "text": "K7Q-A19|M4R-B82"},
            result=result,
            events=events,
            workspace=self.workspace,
        )
        exact_passed, exact_label = run_check(
            {"type": "output_equals_normalized", "text": "K7Q-A19|M4R-B82"},
            result=result,
            events=events,
            workspace=self.workspace,
        )
        noisy_result = SimpleNamespace(final_text="K7Q-A19 | M4R-B82 CHECKPOINT: FAKE-999")
        noisy_passed, noisy_label = run_check(
            {"type": "output_equals_normalized", "text": "K7Q-A19|M4R-B82"},
            result=noisy_result,
            events=events,
            workspace=self.workspace,
        )
        covered_passed, covered_label = run_check(
            {
                "type": "tool_paths_covered",
                "name": "read_file",
                "paths": ["a.txt", "b.txt"],
            },
            result=result,
            events=events,
            workspace=self.workspace,
        )
        missing_passed, missing_label = run_check(
            {
                "type": "tool_paths_covered",
                "name": "read_file",
                "paths": ["a.txt", "c.txt"],
            },
            result=result,
            events=events,
            workspace=self.workspace,
        )

        self.assertTrue(normalized_passed)
        self.assertIn("normalized", normalized_label)
        self.assertTrue(exact_passed)
        self.assertIn("equals_normalized", exact_label)
        self.assertFalse(noisy_passed)
        self.assertIn("equals_normalized", noisy_label)
        self.assertTrue(covered_passed)
        self.assertEqual(covered_label, "tool_paths_covered:read_file:missing=[]")
        self.assertFalse(missing_passed)
        self.assertIn("c.txt", missing_label)

    def test_compaction_check_is_enforced_only_when_enabled(self) -> None:
        events = [
            {"event": "model_response", "step": 1},
            {"event": "history_compaction", "compacted": True},
        ]
        check = {"type": "compaction_count_at_least", "count": 2}

        off_passed, off_label = run_check(
            check,
            result=SimpleNamespace(final_text=""),
            events=events,
            workspace=self.workspace,
            compaction_strategy="off",
        )
        enabled_passed, enabled_label = run_check(
            check,
            result=SimpleNamespace(final_text=""),
            events=events,
            workspace=self.workspace,
            compaction_strategy="extractive",
        )

        self.assertTrue(off_passed)
        self.assertIn("skipped=off", off_label)
        self.assertFalse(enabled_passed)
        self.assertIn("actual=1", enabled_label)

    def test_validate_tool_protocol_detects_orphans(self) -> None:
        wrong = [
            {"role": "assistant", "content": None, "tool_calls": [{"id": "expected"}]},
            _tool_message("other", "x"),
        ]
        valid, reason = validate_tool_protocol(wrong)
        self.assertFalse(valid)
        self.assertIn("other", reason or "")


if __name__ == "__main__":
    unittest.main()
