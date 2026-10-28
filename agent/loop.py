from __future__ import annotations

import json
from typing import Callable

from agent.approval import ApprovalPolicy, ApprovalRequest
from agent.context import inspect_context
from agent.models import AssistantTurn, RunResult, ToolCall
from agent.prompts import SYSTEM_PROMPT
from agent.trace import EventTracer
from tools.spec import ToolRegistry


class AgentLoop:
    """Function-calling agent loop with tracing and harness-level approvals."""

    def __init__(
        self,
        provider,
        registry: ToolRegistry,
        tracer: EventTracer,
        *,
        max_steps: int = 8,
        approval_policy: ApprovalPolicy | None = None,
        context_window_tokens: int = 32768,
        on_event: Callable[[dict], None] | None = None,
    ) -> None:
        if context_window_tokens < 1:
            raise ValueError("context_window_tokens 必须大于 0")
        self.provider = provider
        self.registry = registry
        self.tracer = tracer
        self.max_steps = max_steps
        self.approval_policy = approval_policy
        self.context_window_tokens = context_window_tokens
        self.on_event = on_event

    def run(self, messages: list[dict]) -> RunResult:
        self._record("run_started", max_steps=self.max_steps)
        last_text = ""

        for step in range(1, self.max_steps + 1):
            context_snapshot = inspect_context(messages)
            self._record(
                "model_request",
                step=step,
                context_budget_tokens=self.context_window_tokens,
                **context_snapshot,
            )
            try:
                turn = self.provider.complete(messages, self.registry.openai_schemas())
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
                self._record("model_error", step=step, error=error)
                self._record("run_finished", status="error", steps=step, error=error)
                return RunResult(status="error", final_text=last_text, steps=step, error=error)

            assistant_message = self._assistant_message(turn)
            messages.append(assistant_message)
            last_text = turn.content or ""
            usage = turn.usage.to_dict() if turn.usage is not None else None
            context_usage_ratio = (
                round(usage["prompt_tokens"] / self.context_window_tokens, 6)
                if usage is not None
                else None
            )
            self._record(
                "model_response",
                step=step,
                content=turn.content,
                tool_calls=[
                    {"id": call.id, "name": call.name, "arguments": call.arguments}
                    for call in turn.tool_calls
                ],
                context_budget_tokens=self.context_window_tokens,
                context_usage_ratio=context_usage_ratio,
                usage=usage,
                **context_snapshot,
            )

            if not turn.tool_calls:
                self._record("run_finished", status="completed", steps=step)
                return RunResult(status="completed", final_text=last_text, steps=step)

            for call in turn.tool_calls:
                self._execute_tool_call(messages, call, step)

        final_text = "达到最大步数，任务未完成。"
        self._record("run_finished", status="max_steps", steps=self.max_steps)
        return RunResult(
            status="max_steps",
            final_text=final_text,
            steps=self.max_steps,
            error=final_text,
        )

    def _execute_tool_call(self, messages: list[dict], call: ToolCall, step: int) -> None:
        try:
            arguments = json.loads(call.arguments)
        except json.JSONDecodeError as exc:
            content = f"ERROR: 工具参数不是合法 JSON：{exc.msg}"
            self._record(
                "invalid_tool_arguments",
                step=step,
                tool=call.name,
                arguments=call.arguments,
                error=content,
            )
            self._append_tool_message(messages, call.id, content)
            return

        if not isinstance(arguments, dict):
            content = "ERROR: 工具参数必须是 JSON object"
            self._record(
                "invalid_tool_arguments",
                step=step,
                tool=call.name,
                arguments=call.arguments,
                error=content,
            )
            self._append_tool_message(messages, call.id, content)
            return

        spec = self.registry.get_spec(call.name)
        if spec is not None and spec.requires_approval:
            request = ApprovalRequest(
                tool_name=call.name,
                arguments=arguments,
                risk=spec.risk,
            )
            approved = self.approval_policy(request) if self.approval_policy else False
            if not approved:
                content = f"ERROR: 用户未批准执行工具 {call.name}"
                self._record(
                    "approval_denied",
                    step=step,
                    tool=call.name,
                    arguments=arguments,
                )
                self._append_tool_message(messages, call.id, content)
                return

        self._record(
            "tool_call",
            step=step,
            tool=call.name,
            arguments=arguments,
        )
        result = self.registry.invoke(call.name, arguments)
        self._record(
            "tool_result",
            step=step,
            tool=call.name,
            ok=result.ok,
            duration_ms=result.duration_ms,
            content=result.content,
        )
        self._append_tool_message(messages, call.id, result.content)

    def _assistant_message(self, turn: AssistantTurn) -> dict:
        message = {"role": "assistant", "content": turn.content}
        if turn.tool_calls:
            message["tool_calls"] = [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": call.arguments,
                    },
                }
                for call in turn.tool_calls
            ]
        return message

    @staticmethod
    def _append_tool_message(messages: list[dict], tool_call_id: str, content: str) -> None:
        messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": content,
            }
        )

    def _record(self, event: str, **data) -> None:
        payload = self.tracer.record(event, **data)
        if self.on_event is not None:
            self.on_event(payload)


def initial_messages() -> list[dict]:
    return [{"role": "system", "content": SYSTEM_PROMPT}]
