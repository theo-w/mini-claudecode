from __future__ import annotations

import json
from typing import Any


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
    serialized = json.dumps(
        messages,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    return {
        "context_chars": len(serialized),
        "message_count": len(messages),
        "tool_observation_chars": sum(len(content) for content in tool_contents),
        "tool_observation_count": len(tool_contents),
        "largest_tool_observation_chars": max(
            (len(content) for content in tool_contents), default=0
        ),
    }
