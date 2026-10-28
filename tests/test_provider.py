from __future__ import annotations

import unittest
from types import SimpleNamespace

from agent.config import ModelConfig
from providers.openai_compat import OpenAICompatibleProvider


class FakeCompletions:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        message = SimpleNamespace(content="完成", tool_calls=[])
        return SimpleNamespace(
            choices=[SimpleNamespace(message=message)],
            usage=SimpleNamespace(
                prompt_tokens=10,
                completion_tokens=2,
                total_tokens=12,
            ),
        )


class ProviderProtocolTests(unittest.TestCase):
    def provider(self) -> tuple[OpenAICompatibleProvider, FakeCompletions]:
        completions = FakeCompletions()
        provider = OpenAICompatibleProvider.__new__(OpenAICompatibleProvider)
        provider.config = ModelConfig(
            provider="local",
            base_url="http://127.0.0.1:11434/v1",
            api_key="dummy",
            model="test-model",
        )
        provider.client = SimpleNamespace(
            chat=SimpleNamespace(completions=completions)
        )
        return provider, completions

    def test_summary_call_omits_empty_tools_fields(self) -> None:
        provider, completions = self.provider()

        turn = provider.complete([{"role": "user", "content": "summarize"}], [])

        self.assertEqual(turn.content, "完成")
        self.assertEqual(
            completions.calls,
            [
                {
                    "model": "test-model",
                    "messages": [{"role": "user", "content": "summarize"}],
                }
            ],
        )

    def test_tool_call_request_keeps_tool_choice(self) -> None:
        provider, completions = self.provider()
        tools = [{"type": "function", "function": {"name": "read_file"}}]

        provider.complete([{"role": "user", "content": "read"}], tools)

        self.assertEqual(completions.calls[0]["tools"], tools)
        self.assertEqual(completions.calls[0]["tool_choice"], "auto")


if __name__ == "__main__":
    unittest.main()
