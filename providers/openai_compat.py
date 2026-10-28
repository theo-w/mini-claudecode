from __future__ import annotations

from openai import OpenAI

from agent.config import ModelConfig
from agent.models import AssistantTurn, ToolCall


class ProviderError(RuntimeError):
    pass


class OpenAICompatibleProvider:
    """Small adapter around the OpenAI Chat Completions tool-calling protocol."""

    def __init__(self, config: ModelConfig) -> None:
        self.config = config
        self.client = OpenAI(
            api_key=config.api_key,
            base_url=config.base_url,
            timeout=config.request_timeout_seconds,
        )

    def complete(self, messages: list[dict], tools: list[dict]) -> AssistantTurn:
        response = self.client.chat.completions.create(
            model=self.config.model,
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )
        if not response.choices:
            raise ProviderError("模型响应中没有 choices")

        message = response.choices[0].message
        tool_calls: list[ToolCall] = []
        for call in message.tool_calls or []:
            tool_calls.append(
                ToolCall(
                    id=call.id,
                    name=call.function.name,
                    arguments=call.function.arguments,
                )
            )
        return AssistantTurn(content=message.content, tool_calls=tool_calls)
