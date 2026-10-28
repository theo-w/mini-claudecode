from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from agent.config import load_harness_config
from agent.context import inspect_context
from agent.loop import AgentLoop, initial_messages
from agent.models import AssistantTurn, TokenUsage, ToolCall
from agent.trace import EventTracer
from providers.openai_compat import _extract_usage
from scripts.run_eval import (
    aggregate_records,
    context_metrics_from_events,
    group_summaries,
    run_check,
    write_setup,
)
from tools.builtin import build_registry
from tools.spec import ToolRegistry, ToolSpec


class ScriptedUsageProvider:
    def __init__(self, turns: list[AssistantTurn]) -> None:
        self.turns = list(turns)

    def complete(self, messages: list[dict], tools: list[dict]) -> AssistantTurn:
        return self.turns.pop(0)


class ContextBudgetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()

    def test_extract_usage_returns_none_when_provider_omits_it(self) -> None:
        self.assertIsNone(_extract_usage(SimpleNamespace(usage=None)))

    def test_extract_usage_reads_prompt_completion_and_total_tokens(self) -> None:
        response = SimpleNamespace(
            usage=SimpleNamespace(
                prompt_tokens=120,
                completion_tokens=18,
                total_tokens=138,
            )
        )

        usage = _extract_usage(response)

        self.assertEqual(
            usage,
            TokenUsage(prompt_tokens=120, completion_tokens=18, total_tokens=138),
        )

    def test_extract_usage_derives_total_when_provider_omits_it(self) -> None:
        response = SimpleNamespace(
            usage=SimpleNamespace(prompt_tokens=120, completion_tokens=18)
        )

        usage = _extract_usage(response)

        self.assertEqual(
            usage,
            TokenUsage(prompt_tokens=120, completion_tokens=18, total_tokens=138),
        )

    def test_inspect_context_separates_tool_observations(self) -> None:
        messages = [
            {"role": "system", "content": "system"},
            {"role": "user", "content": "question"},
            {"role": "tool", "tool_call_id": "1", "content": "x" * 80},
            {"role": "tool", "tool_call_id": "2", "content": "y" * 20},
        ]

        metrics = inspect_context(messages)

        self.assertEqual(metrics["message_count"], 4)
        self.assertEqual(metrics["tool_observation_count"], 2)
        self.assertEqual(metrics["tool_observation_chars"], 100)
        self.assertEqual(metrics["largest_tool_observation_chars"], 80)
        self.assertGreater(metrics["context_chars"], 100)

    def test_loop_records_context_and_usage_each_turn(self) -> None:
        registry = build_registry(self.workspace)
        tracer = EventTracer()
        provider = ScriptedUsageProvider(
            [
                AssistantTurn(
                    content=None,
                    tool_calls=[
                        ToolCall(id="call-1", name="ls", arguments='{"dir_path":"."}')
                    ],
                    usage=TokenUsage(
                        prompt_tokens=90,
                        completion_tokens=12,
                        total_tokens=102,
                    ),
                ),
                AssistantTurn(
                    content="完成。",
                    usage=TokenUsage(
                        prompt_tokens=110,
                        completion_tokens=5,
                        total_tokens=115,
                    ),
                ),
            ]
        )
        agent = AgentLoop(
            provider,
            registry,
            tracer,
            max_steps=3,
            context_window_tokens=1000,
        )
        messages = initial_messages()
        messages.append({"role": "user", "content": "列出文件"})

        agent.run(messages)

        requests = [event for event in tracer.events if event["event"] == "model_request"]
        responses = [event for event in tracer.events if event["event"] == "model_response"]
        self.assertEqual(len(requests), 2)
        self.assertEqual(len(responses), 2)
        self.assertTrue(all("context_chars" in event for event in requests))
        self.assertEqual(responses[0]["usage"]["prompt_tokens"], 90)
        self.assertEqual(responses[0]["context_usage_ratio"], 0.09)
        self.assertEqual(responses[1]["context_usage_ratio"], 0.11)
        self.assertGreater(
            responses[1]["tool_observation_chars"],
            responses[0]["tool_observation_chars"],
        )

    def test_context_metrics_from_events_handles_missing_usage(self) -> None:
        events = [
            {
                "event": "model_response",
                "step": 1,
                "context_chars": 200,
                "tool_observation_chars": 20,
                "usage": None,
                "context_usage_ratio": None,
            },
            {
                "event": "model_response",
                "step": 2,
                "context_chars": 350,
                "tool_observation_chars": 120,
                "usage": {
                    "prompt_tokens": 80,
                    "completion_tokens": 10,
                    "total_tokens": 90,
                },
                "context_usage_ratio": 0.08,
            },
        ]

        metrics = context_metrics_from_events(events)

        self.assertEqual(metrics["model_calls"], 2)
        self.assertEqual(metrics["usage_calls"], 1)
        self.assertEqual(metrics["input_tokens"], 80)
        self.assertEqual(metrics["output_tokens"], 10)
        self.assertEqual(metrics["total_tokens"], 90)
        self.assertEqual(metrics["peak_context_chars"], 350)
        self.assertEqual(metrics["peak_tool_observation_chars"], 120)
        self.assertEqual(metrics["peak_prompt_tokens"], 80)
        self.assertEqual(len(metrics["turns"]), 2)

    def test_aggregate_and_group_metrics(self) -> None:
        records = [
            {
                "group": "scan",
                "passed": True,
                "steps": 4,
                "duration_seconds": 2.0,
                "context": {
                    "input_tokens": 100,
                    "output_tokens": 10,
                    "total_tokens": 110,
                    "peak_context_chars": 500,
                    "peak_prompt_tokens": 120,
                },
            },
            {
                "group": "scan",
                "passed": False,
                "steps": 2,
                "duration_seconds": 1.0,
                "context": {
                    "input_tokens": None,
                    "output_tokens": None,
                    "total_tokens": None,
                    "peak_context_chars": 300,
                    "peak_prompt_tokens": None,
                },
            },
            {
                "group": "grep_first",
                "passed": True,
                "steps": 3,
                "duration_seconds": 1.5,
                "context": {
                    "input_tokens": 80,
                    "output_tokens": 8,
                    "total_tokens": 88,
                    "peak_context_chars": 450,
                    "peak_prompt_tokens": 90,
                },
            },
        ]

        aggregate = aggregate_records(records)
        groups = group_summaries(records)

        self.assertEqual(aggregate["usage_available_tasks"], 2)
        self.assertEqual(aggregate["total_input_tokens"], 180)
        self.assertEqual(groups["scan"]["success_rate"], 0.5)
        self.assertEqual(groups["scan"]["average_steps"], 3.0)
        self.assertEqual(groups["scan"]["usage_available_tasks"], 1)
        self.assertEqual(groups["grep_first"]["total"], 1)

    def test_context_window_config_is_validated(self) -> None:
        config = load_harness_config(
            env={"CONTEXT_WINDOW_TOKENS": "4096"},
            workspace=self.workspace,
        )
        self.assertEqual(config.context_window_tokens, 4096)

        with self.assertRaisesRegex(ValueError, "CONTEXT_WINDOW_TOKENS"):
            load_harness_config(
                env={"CONTEXT_WINDOW_TOKENS": "0"},
                workspace=self.workspace,
            )

    def test_read_file_paginates_with_continuation_metadata(self) -> None:
        lines = [f"line-{index:03d} " + "x" * 40 for index in range(1, 161)]
        lines[129] = "line-130 ACCESS_CODE=CONTINUE-OK"
        (self.workspace / "large.log").write_text(
            "\n".join(lines) + "\n", encoding="utf-8"
        )
        registry = build_registry(self.workspace, max_observation_chars=900)

        start_line = 1
        found = False
        for _ in range(30):
            result = registry.invoke(
                "read_file",
                {"file_path": "large.log", "start_line": start_line},
            )
            self.assertTrue(result.ok, result.content)
            self.assertLessEqual(len(result.content), 900)
            self.assertIn("returned_range:", result.content)
            if "CONTINUE-OK" in result.content:
                found = True
                break
            self.assertIn("has_more: true", result.content)
            next_line = next(
                int(line.split(":", 1)[1].strip())
                for line in result.content.splitlines()
                if line.startswith("next_start_line:")
            )
            self.assertGreater(next_line, start_line)
            start_line = next_line

        self.assertTrue(found)

    def test_read_file_exposes_file_continuation_after_requested_range(self) -> None:
        lines = [f"line-{index:03d}" for index in range(1, 121)]
        (self.workspace / "partial.log").write_text(
            "\n".join(lines) + "\n", encoding="utf-8"
        )
        registry = build_registry(self.workspace, max_observation_chars=2000)

        result = registry.invoke(
            "read_file",
            {"file_path": "partial.log", "start_line": 97, "end_line": 100},
        )

        self.assertTrue(result.ok, result.content)
        self.assertIn("requested_range: 97-100", result.content)
        self.assertIn("returned_range: 97-100", result.content)
        self.assertIn("has_more: false", result.content)
        self.assertIn("file_has_more: true", result.content)
        self.assertIn("next_start_line: 101", result.content)

    def test_read_file_clamps_end_and_reports_budget_limited_file_tail(self) -> None:
        lines = [f"line-{index:03d} " + "x" * 40 for index in range(1, 191)]
        (self.workspace / "clamped.log").write_text(
            "\n".join(lines) + "\n", encoding="utf-8"
        )
        registry = build_registry(self.workspace, max_observation_chars=700)

        result = registry.invoke(
            "read_file",
            {"file_path": "clamped.log", "end_line": 999},
        )

        self.assertTrue(result.ok, result.content)
        self.assertIn("requested_range: 1-190", result.content)
        self.assertIn("has_more: true", result.content)
        self.assertIn("file_has_more: true", result.content)
        returned_range = next(
            line.split(":", 1)[1].strip()
            for line in result.content.splitlines()
            if line.startswith("returned_range:")
        )
        returned_end = int(returned_range.split("-", 1)[1])
        next_start_line = next(
            int(line.split(":", 1)[1].strip())
            for line in result.content.splitlines()
            if line.startswith("next_start_line:")
        )
        self.assertLess(returned_end, 190)
        self.assertEqual(next_start_line, returned_end + 1)

    def test_observation_is_bounded_and_has_metadata(self) -> None:
        registry = ToolRegistry(self.workspace, max_observation_chars=120)
        registry.register(
            ToolSpec(
                name="flood",
                description="return a large observation",
                parameters={
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
                handler=lambda: "x" * 500,
            )
        )

        result = registry.invoke("flood", {})

        self.assertTrue(result.ok)
        self.assertLessEqual(len(result.content), 120)
        self.assertIn("observation_truncated", result.content)
        self.assertIn("original_chars=500", result.content)
        self.assertIn("returned_chars=", result.content)

    def test_read_file_rejects_single_line_over_budget(self) -> None:
        (self.workspace / "one-line.txt").write_text("x" * 2000, encoding="utf-8")
        registry = build_registry(self.workspace, max_observation_chars=300)

        result = registry.invoke("read_file", {"file_path": "one-line.txt"})

        self.assertFalse(result.ok)
        self.assertIn("单行", result.content)
        self.assertNotIn("x" * 1000, result.content)

    def test_write_setup_expands_repeated_lines(self) -> None:
        write_setup(
            self.workspace,
            {
                "generated.log": {
                    "head_lines": ["START"],
                    "repeat_lines": ["alpha", "beta"],
                    "repeat": 3,
                    "tail_lines": ["ACCESS_CODE: TEST-1"],
                }
            },
        )

        self.assertEqual(
            (self.workspace / "generated.log").read_text(encoding="utf-8"),
            "START\nalpha\nbeta\nalpha\nbeta\nalpha\nbeta\nACCESS_CODE: TEST-1\n",
        )

    def test_m1_task_contract(self) -> None:
        tasks = json.loads(
            (Path(__file__).resolve().parents[1] / "evals" / "m1_tasks.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertEqual(len(tasks), 5)
        self.assertEqual(len({task["id"] for task in tasks}), len(tasks))
        self.assertEqual(
            {task.get("group") for task in tasks},
            {"scan", "grep_first", "multi_file"},
        )
        for task in tasks:
            self.assertGreaterEqual(task["max_steps"], 1)
            self.assertTrue(task["prompt"])
            self.assertTrue(task["checks"])
            for check in task["checks"]:
                self.assertIn("type", check)
            for fixture in task.get("setup", {}).values():
                self.assertIsInstance(fixture, (str, dict))

        scan_tasks = [task for task in tasks if task.get("group") == "scan"]
        self.assertEqual(len(scan_tasks), 2)
        for task in scan_tasks:
            self.assertIn(
                {
                    "type": "tool_call_count_at_least",
                    "name": "read_file",
                    "count": 2,
                },
                task["checks"],
            )
            self.assertIn(
                {"type": "tool_not_called", "name": "grep"},
                task["checks"],
            )

        grep_tasks = [task for task in tasks if task.get("group") == "grep_first"]
        for task in grep_tasks:
            self.assertIn(
                {
                    "type": "tool_called_before",
                    "first": "grep",
                    "second": "read_file",
                },
                task["checks"],
            )

    def test_tool_called_before_checks_event_order(self) -> None:
        result = SimpleNamespace(final_text="")
        check = {
            "type": "tool_called_before",
            "first": "grep",
            "second": "read_file",
        }
        grep_then_read = [
            {"event": "tool_call", "tool": "grep"},
            {"event": "tool_call", "tool": "read_file"},
        ]
        read_then_grep = list(reversed(grep_then_read))

        passed, _ = run_check(
            check,
            result=result,
            events=grep_then_read,
            workspace=self.workspace,
        )
        failed, _ = run_check(
            check,
            result=result,
            events=read_then_grep,
            workspace=self.workspace,
        )

        self.assertTrue(passed)
        self.assertFalse(failed)


if __name__ == "__main__":
    unittest.main()
