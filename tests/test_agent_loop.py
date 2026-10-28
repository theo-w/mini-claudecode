from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from agent.approval import AutoApprove, DenyAll
from agent.loop import AgentLoop, initial_messages
from agent.models import AssistantTurn, ToolCall
from agent.trace import EventTracer
from tools.builtin import build_registry


class ScriptedProvider:
    def __init__(self, turns: list[AssistantTurn]) -> None:
        self.turns = list(turns)
        self.calls = 0

    def complete(self, messages: list[dict], tools: list[dict]) -> AssistantTurn:
        self.calls += 1
        if not self.turns:
            raise AssertionError("没有剩余脚本响应")
        return self.turns.pop(0)


class AgentLoopTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.workspace = Path(self.temp_dir.name)
        self.registry = build_registry(self.workspace)

    def run_agent(self, provider, messages, *, approval=None, max_steps=4):
        tracer = EventTracer()
        agent = AgentLoop(
            provider,
            self.registry,
            tracer,
            max_steps=max_steps,
            approval_policy=approval,
        )
        return agent.run(messages), tracer.events

    def test_tool_call_then_final_answer(self) -> None:
        (self.workspace / "README.md").write_text("hello", encoding="utf-8")
        provider = ScriptedProvider(
            [
                AssistantTurn(
                    content=None,
                    tool_calls=[
                        ToolCall(id="call-1", name="ls", arguments='{"dir_path":"."}')
                    ],
                ),
                AssistantTurn(content="目录中只有 README.md。"),
            ]
        )
        messages = initial_messages()
        messages.append({"role": "user", "content": "列出文件"})

        result, events = self.run_agent(provider, messages)

        self.assertEqual(result.status, "completed")
        self.assertEqual(result.steps, 2)
        self.assertIn("README.md", result.final_text)
        event_names = [event["event"] for event in events]
        self.assertIn("tool_call", event_names)
        self.assertIn("tool_result", event_names)
        self.assertEqual(provider.calls, 2)
        tool_messages = [message for message in messages if message.get("role") == "tool"]
        self.assertEqual(tool_messages[0]["tool_call_id"], "call-1")

    def test_write_is_blocked_without_approval(self) -> None:
        provider = ScriptedProvider(
            [
                AssistantTurn(
                    content=None,
                    tool_calls=[
                        ToolCall(
                            id="call-write",
                            name="write_file",
                            arguments='{"file_path":"x.txt","content":"bad"}',
                        )
                    ],
                ),
                AssistantTurn(content="写操作被拒绝。"),
            ]
        )
        messages = initial_messages()
        messages.append({"role": "user", "content": "创建文件"})

        result, events = self.run_agent(provider, messages, approval=DenyAll())

        self.assertEqual(result.status, "completed")
        self.assertFalse((self.workspace / "x.txt").exists())
        self.assertIn("approval_denied", [event["event"] for event in events])

    def test_malformed_arguments_are_fed_back_to_model(self) -> None:
        provider = ScriptedProvider(
            [
                AssistantTurn(
                    content=None,
                    tool_calls=[
                        ToolCall(id="call-bad", name="ls", arguments="{not-json")
                    ],
                ),
                AssistantTurn(content="参数错误已修正。"),
            ]
        )
        messages = initial_messages()
        messages.append({"role": "user", "content": "列出文件"})

        result, events = self.run_agent(provider, messages, approval=AutoApprove())

        self.assertEqual(result.status, "completed")
        self.assertIn("invalid_tool_arguments", [event["event"] for event in events])
        tool_messages = [message for message in messages if message.get("role") == "tool"]
        self.assertIn("不是合法 JSON", tool_messages[0]["content"])

    def test_max_steps_is_hard_stop(self) -> None:
        provider = ScriptedProvider(
            [
                AssistantTurn(
                    content=None,
                    tool_calls=[
                        ToolCall(id=f"call-{index}", name="ls", arguments='{"dir_path":"."}')
                    ],
                )
                for index in range(3)
            ]
        )
        messages = initial_messages()
        messages.append({"role": "user", "content": "不要停止"})

        result, events = self.run_agent(provider, messages, max_steps=3)

        self.assertEqual(result.status, "max_steps")
        self.assertEqual(result.steps, 3)
        self.assertEqual(provider.calls, 3)
        self.assertEqual(events[-1]["event"], "run_finished")

    def test_invalid_tool_arguments_do_not_crash_loop(self) -> None:
        provider = ScriptedProvider(
            [
                AssistantTurn(
                    content=None,
                    tool_calls=[
                        ToolCall(
                            id="call-unknown",
                            name="unknown_tool",
                            arguments='{"x":1}',
                        )
                    ],
                ),
                AssistantTurn(content="工具不存在，停止。"),
            ]
        )
        messages = initial_messages()
        messages.append({"role": "user", "content": "测试"})

        result, _ = self.run_agent(provider, messages, approval=AutoApprove())
        self.assertEqual(result.status, "completed")


if __name__ == "__main__":
    unittest.main()
