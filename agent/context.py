from __future__ import annotations

import json
from typing import Any

COMPACTED_HISTORY_MARKER = "[COMPACTED_HISTORY_V1"


def is_compacted_summary(message: dict[str, Any]) -> bool:
    return (
        message.get("role") == "system"
        and COMPACTED_HISTORY_MARKER in str(message.get("content") or "")
    )


def inspect_context(messages: list[dict[str, Any]]) -> dict[str, int]:
    """Return a deterministic, provider-independent context snapshot.

    The character count includes the serialized message protocol envelope. It is
    useful for comparing runs, but it is not a substitute for provider token usage.
    """

    tool_contents = [
        str(message.get("content") or "")
        for message in messages
        if message.get("role") == "tool"
    ]
    compacted_contents = [
        str(message.get("content") or "")
        for message in messages
        if is_compacted_summary(message)
    ]
    role_counts = {
        role: sum(1 for message in messages if message.get("role") == role)
        for role in ("system", "user", "assistant", "tool")
    }
    serialized = json.dumps(
        messages,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    return {
        "context_chars": len(serialized),
        "message_count": len(messages),
        "system_message_count": role_counts["system"],
        "user_message_count": role_counts["user"],
        "assistant_message_count": role_counts["assistant"],
        "tool_message_count": role_counts["tool"],
        "tool_observation_chars": sum(len(content) for content in tool_contents),
        "tool_observation_count": len(tool_contents),
        "largest_tool_observation_chars": max(
            (len(content) for content in tool_contents), default=0
        ),
        "compacted_summary_count": len(compacted_contents),
        "compacted_summary_chars": sum(len(content) for content in compacted_contents),
    }
