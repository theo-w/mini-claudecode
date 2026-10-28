from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Literal

from agent.context import (
    COMPACTED_HISTORY_MARKER,
    inspect_context,
    is_compacted_summary,
)

CompactionStrategy = Literal["off", "extractive", "model"]
VALID_COMPACTION_STRATEGIES = ("off", "extractive", "model")

_ERROR_RE = re.compile(
    r"(?i)\b(?:error|warn(?:ing)?|failed|failure|exception|traceback|denied|panic)\b"
)
_TODO_RE = re.compile(r"(?i)\b(?:todo|fixme|pending|blocked|remaining)\b")
_UPPER_ASSIGNMENT_RE = re.compile(r"\b[A-Z][A-Z0-9_]{2,}\s*[:=]")
_UPPER_TERM_RE = re.compile(r"\b[A-Z][A-Z0-9_]{2,}\b")
_FILE_TERM_RE = re.compile(
    r"(?<![\w./-])(?:[\w.-]+/)*[\w.-]+\.(?:log|txt|md|py|json|ya?ml|toml|csv|tsv|html)"
)
_QUOTED_TERM_RE = re.compile(r"[`'\"]([^`'\"]{3,80})[`'\"]")
_LINE_PREFIX_RE = re.compile(r"^\s*(\d+)\t(.*)$")
_GREP_LINE_RE = re.compile(r"^(\d+):(.*)$")
_SUMMARY_BULLET_RE = re.compile(r"^- \[[^\]]+\].+")

_SUMMARY_SYSTEM_PROMPT = """你是 Agent 的上下文压缩器。输入是较早的对话和工具 observation。
你的唯一任务是把它们压缩成可供后续 Agent 继续工作的摘要。

必须遵守：
1. 保留文件名、工具名、行号、退出码和错误原文；
2. 保留 TODO、FIXME、pending、blocked 等未完成状态；
3. 保留用户任务要求和已经确认的事实；
4. 不得推断未出现在输入中的内容，不得声称执行过未执行的操作；
5. 优先复制 EVIDENCE_LEDGER 中的证据，不要改写其中的值；
6. 不调用工具，只输出摘要正文。
"""


@dataclass(frozen=True)
class CompactionConfig:
    strategy: CompactionStrategy = "off"
    trigger_tokens: int | None = None
    keep_recent_messages: int = 6
    max_summary_chars: int = 4000

    def __post_init__(self) -> None:
        if self.strategy not in VALID_COMPACTION_STRATEGIES:
            raise ValueError(f"不支持的压缩策略：{self.strategy!r}")
        if self.trigger_tokens is not None and self.trigger_tokens < 1:
            raise ValueError("trigger_tokens 必须大于 0")
        if self.strategy != "off" and self.trigger_tokens is None:
            raise ValueError("启用压缩时必须提供 trigger_tokens")
        if self.keep_recent_messages < 1:
            raise ValueError("keep_recent_messages 必须大于 0")
        if self.max_summary_chars < 128:
            raise ValueError("max_summary_chars 必须大于等于 128")


@dataclass(frozen=True)
class CompactionResult:
    compacted: bool
    configured_strategy: str
    effective_strategy: str | None
    reason: str | None
    trigger_prompt_tokens: int | None
    messages_before: int
    messages_after: int
    context_chars_before: int
    context_chars_after: int
    summary_chars: int
    evidence_count: int
    fallback_reason: str | None = None
    summary_usage: dict[str, int] | None = None
    summary_duration_ms: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "compacted": self.compacted,
            "configured_strategy": self.configured_strategy,
            "effective_strategy": self.effective_strategy,
            "reason": self.reason,
            "trigger_prompt_tokens": self.trigger_prompt_tokens,
            "messages_before": self.messages_before,
            "messages_after": self.messages_after,
            "context_chars_before": self.context_chars_before,
            "context_chars_after": self.context_chars_after,
            "compacted_chars": self.context_chars_before - self.context_chars_after,
            "summary_chars": self.summary_chars,
            "evidence_count": self.evidence_count,
            "fallback_reason": self.fallback_reason,
            "summary_usage": self.summary_usage,
            "summary_duration_ms": self.summary_duration_ms,
        }


class HistoryCompactor:
    """Rolling summary compactor with deterministic evidence extraction."""

    def __init__(self, config: CompactionConfig) -> None:
        self.config = config

    def compact(
        self,
        messages: list[dict[str, Any]],
        *,
        provider=None,
        record: Callable[..., Any] | None = None,
        step: int | None = None,
        prompt_tokens: int | None = None,
    ) -> CompactionResult:
        before = inspect_context(messages)
        messages_before = len(messages)
        if self.config.strategy == "off":
            return self._no_op(before, messages_before, "disabled", prompt_tokens)

        latest_user_index = _latest_user_index(messages)
        if latest_user_index is None:
            return self._no_op(before, messages_before, "no_user_anchor", prompt_tokens)

        protected_start = max(
            latest_user_index + 1,
            len(messages) - self.config.keep_recent_messages,
        )
        safe_start = _safe_protected_start(messages, protected_start, latest_user_index)
        if safe_start is None:
            return self._no_op(
                before,
                messages_before,
                "unsafe_tool_boundary",
                prompt_tokens,
            )

        pinned_system_indexes = {
            index
            for index, message in enumerate(messages)
            if message.get("role") == "system" and not is_compacted_summary(message)
        }
        pinned_systems = [messages[index] for index in sorted(pinned_system_indexes)]
        old_segment = [
            message
            for index, message in enumerate(messages)
            if index < safe_start
            and index != latest_user_index
            and index not in pinned_system_indexes
        ]
        if not old_segment:
            return self._no_op(before, messages_before, "no_older_history", prompt_tokens)

        latest_user = messages[latest_user_index]
        suffix = messages[safe_start:]
        focus_terms = _extract_focus_terms(str(latest_user.get("content") or ""))
        extractive_body, evidence_bullets = _build_extractive_summary(
            old_segment,
            focus_terms=focus_terms,
            max_chars=self.config.max_summary_chars,
        )

        effective_strategy = "extractive"
        fallback_reason = None
        summary_usage = None
        summary_duration_ms = None
        summary = _summary_message(
            "extractive",
            extractive_body,
            self.config.max_summary_chars,
        )
        if self.config.strategy == "model":
            model_summary, summary_usage, summary_duration_ms, fallback_reason = (
                self._model_summary(
                    old_segment,
                    evidence_ledger=extractive_body,
                    focus_terms=focus_terms,
                    provider=provider,
                    record=record,
                    step=step,
                    prompt_tokens=prompt_tokens,
                )
            )
            if model_summary is None:
                effective_strategy = "extractive"
            else:
                effective_strategy = "model"
                summary = _summary_message(
                    "model",
                    model_summary,
                    self.config.max_summary_chars,
                )

        candidate = pinned_systems + [summary, latest_user] + list(suffix)
        valid, protocol_error = validate_tool_protocol(candidate)
        if not valid:
            return CompactionResult(
                compacted=False,
                configured_strategy=self.config.strategy,
                effective_strategy=None,
                reason=f"protocol_violation:{protocol_error}",
                trigger_prompt_tokens=prompt_tokens,
                messages_before=messages_before,
                messages_after=messages_before,
                context_chars_before=before["context_chars"],
                context_chars_after=before["context_chars"],
                summary_chars=0,
                evidence_count=0,
                fallback_reason=fallback_reason,
                summary_usage=summary_usage,
                summary_duration_ms=summary_duration_ms,
            )

        after = inspect_context(candidate)
        if after["context_chars"] >= before["context_chars"]:
            return CompactionResult(
                compacted=False,
                configured_strategy=self.config.strategy,
                effective_strategy=None,
                reason="summary_not_smaller",
                trigger_prompt_tokens=prompt_tokens,
                messages_before=messages_before,
                messages_after=messages_before,
                context_chars_before=before["context_chars"],
                context_chars_after=before["context_chars"],
                summary_chars=0,
                evidence_count=0,
                fallback_reason=fallback_reason,
                summary_usage=summary_usage,
                summary_duration_ms=summary_duration_ms,
            )

        messages[:] = candidate
        return CompactionResult(
            compacted=True,
            configured_strategy=self.config.strategy,
            effective_strategy=effective_strategy,
            reason="triggered",
            trigger_prompt_tokens=prompt_tokens,
            messages_before=messages_before,
            messages_after=len(messages),
            context_chars_before=before["context_chars"],
            context_chars_after=after["context_chars"],
            summary_chars=len(str(summary.get("content") or "")),
            evidence_count=len(evidence_bullets),
            fallback_reason=fallback_reason,
            summary_usage=summary_usage,
            summary_duration_ms=summary_duration_ms,
        )

    def _model_summary(
        self,
        old_segment: list[dict[str, Any]],
        *,
        evidence_ledger: str,
        focus_terms: list[str],
        provider,
        record: Callable[..., Any] | None,
        step: int | None,
        prompt_tokens: int | None,
    ) -> tuple[str | None, dict[str, int] | None, int | None, str | None]:
        if provider is None:
            return None, None, None, "provider_unavailable"

        transcript = _render_transcript(old_segment)
        max_transcript_chars = max(12000, self.config.max_summary_chars * 12)
        transcript_truncated = len(transcript) > max_transcript_chars
        if transcript_truncated:
            transcript = transcript[:max_transcript_chars]
        request_text = (
            f"用户任务关键标识：{', '.join(focus_terms) if focus_terms else '(未提取到)'}\n\n"
            f"EVIDENCE_LEDGER（优先原样保留）：\n{evidence_ledger}\n\n"
            f"HISTORY_TRANSCRIPT{'（已截断）' if transcript_truncated else ''}：\n"
            f"{transcript}"
        )
        summary_messages = [
            {"role": "system", "content": _SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": request_text},
        ]
        snapshot = inspect_context(summary_messages)
        if record is not None:
            record(
                "compaction_model_request",
                step=step,
                trigger_prompt_tokens=prompt_tokens,
                transcript_chars=len(transcript),
                transcript_truncated=transcript_truncated,
                **snapshot,
            )

        started = time.perf_counter()
        try:
            turn = provider.complete(summary_messages, [])
        except Exception as exc:
            duration_ms = int((time.perf_counter() - started) * 1000)
            if record is not None:
                record(
                    "compaction_model_error",
                    step=step,
                    duration_ms=duration_ms,
                    error=f"{type(exc).__name__}: {exc}",
                )
            return None, None, duration_ms, f"{type(exc).__name__}: {exc}"

        duration_ms = int((time.perf_counter() - started) * 1000)
        usage = turn.usage.to_dict() if turn.usage is not None else None
        if record is not None:
            record(
                "compaction_model_response",
                step=step,
                duration_ms=duration_ms,
                usage=usage,
                content=turn.content,
                tool_calls=[
                    {"id": call.id, "name": call.name, "arguments": call.arguments}
                    for call in turn.tool_calls
                ],
            )

        if turn.tool_calls:
            return None, usage, duration_ms, "summary_returned_tool_calls"
        content = (turn.content or "").strip()
        if not content:
            return None, usage, duration_ms, "empty_summary"
        marker = f"{COMPACTED_HISTORY_MARKER} strategy=model]"
        available_summary_chars = self.config.max_summary_chars - len(marker) - 1
        if len(content) > available_summary_chars:
            return None, usage, duration_ms, "summary_over_budget"
        missing_facts = _missing_required_facts(content, evidence_ledger)
        if missing_facts:
            preview = ", ".join(missing_facts[:3])
            return None, usage, duration_ms, f"missing_required_evidence:{preview}"
        return content, usage, duration_ms, None

    def _no_op(
        self,
        snapshot: dict[str, int],
        messages_before: int,
        reason: str,
        prompt_tokens: int | None,
    ) -> CompactionResult:
        return CompactionResult(
            compacted=False,
            configured_strategy=self.config.strategy,
            effective_strategy=None,
            reason=reason,
            trigger_prompt_tokens=prompt_tokens,
            messages_before=messages_before,
            messages_after=messages_before,
            context_chars_before=snapshot["context_chars"],
            context_chars_after=snapshot["context_chars"],
            summary_chars=0,
            evidence_count=0,
        )


def validate_tool_protocol(messages: list[dict[str, Any]]) -> tuple[bool, str | None]:
    """Validate the contiguous assistant-tool exchange groups we emit."""

    pending: set[str] = set()
    for index, message in enumerate(messages):
        role = message.get("role")
        if role == "assistant" and message.get("tool_calls"):
            if pending:
                return False, f"missing tool responses before index {index}: {sorted(pending)}"
            ids = [str(call.get("id")) for call in message["tool_calls"]]
            if any(not call_id or call_id == "None" for call_id in ids):
                return False, f"tool call without id at index {index}"
            if len(ids) != len(set(ids)):
                return False, f"duplicate tool call id at index {index}"
            pending = set(ids)
            continue

        if role == "tool":
            tool_call_id = str(message.get("tool_call_id"))
            if tool_call_id not in pending:
                return False, f"orphan tool message {tool_call_id!r} at index {index}"
            pending.remove(tool_call_id)
            continue

        if pending:
            return False, f"missing tool responses before index {index}: {sorted(pending)}"

    if pending:
        return False, f"missing tool responses at end: {sorted(pending)}"
    return True, None


def _latest_user_index(messages: list[dict[str, Any]]) -> int | None:
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "user":
            return index
    return None


def _safe_protected_start(
    messages: list[dict[str, Any]],
    start: int,
    latest_user_index: int,
) -> int | None:
    if start >= len(messages):
        return len(messages)
    if messages[start].get("role") != "tool":
        return start

    tool_call_id = str(messages[start].get("tool_call_id"))
    for index in range(start - 1, latest_user_index, -1):
        message = messages[index]
        if message.get("role") != "assistant" or not message.get("tool_calls"):
            continue
        call_ids = {str(call.get("id")) for call in message["tool_calls"]}
        if tool_call_id in call_ids:
            return index
    return None


def _extract_focus_terms(text: str) -> list[str]:
    terms = set(_UPPER_TERM_RE.findall(text))
    terms.update(_FILE_TERM_RE.findall(text))
    terms.update(match.strip() for match in _QUOTED_TERM_RE.findall(text))
    ignored = {"README", "TODO", "FIXME", "ERROR", "WARN", "INFO", "DEBUG"}
    return sorted(
        (term for term in terms if term and term not in ignored),
        key=lambda item: (-len(item), item),
    )


def _tool_call_map(messages: list[dict[str, Any]]) -> dict[str, tuple[str, dict[str, Any]]]:
    mapping: dict[str, tuple[str, dict[str, Any]]] = {}
    for message in messages:
        if message.get("role") != "assistant":
            continue
        for call in message.get("tool_calls") or []:
            function = call.get("function") or {}
            try:
                arguments = json.loads(function.get("arguments") or "{}")
            except (TypeError, json.JSONDecodeError):
                arguments = {}
            if not isinstance(arguments, dict):
                arguments = {}
            mapping[str(call.get("id"))] = (str(function.get("name") or "unknown"), arguments)
    return mapping


def _source_label(name: str, arguments: dict[str, Any]) -> str:
    for key in ("file_path", "dir_path", "root", "path"):
        value = arguments.get(key)
        if value:
            return f"{key}={value}"
    if arguments.get("cmd"):
        return f"cmd={str(arguments['cmd'])[:80]}"
    if arguments:
        compact = json.dumps(arguments, ensure_ascii=False, separators=(",", ":"))
        return f"args={compact[:100]}"
    return "args={}"


def _build_extractive_summary(
    old_segment: list[dict[str, Any]],
    *,
    focus_terms: list[str],
    max_chars: int,
) -> tuple[str, list[str]]:
    tool_calls = _tool_call_map(old_segment)
    evidence: list[tuple[int, int, str]] = []
    context: list[tuple[int, int, str]] = []
    order = 0

    for message in old_segment:
        role = message.get("role")
        if is_compacted_summary(message):
            for line in str(message.get("content") or "").splitlines():
                stripped = line.strip()
                if stripped.startswith("- [context]"):
                    context.append((0, order, stripped))
                    order += 1
                elif _SUMMARY_BULLET_RE.match(stripped):
                    evidence.append((0, order, stripped))
                    order += 1
            continue

        if role == "user":
            text = _one_line(str(message.get("content") or ""), 240)
            if text:
                context.append((5, order, f"- [context] user: {text}"))
                order += 1
            continue

        if role == "assistant":
            if message.get("tool_calls"):
                for call in message.get("tool_calls") or []:
                    function = call.get("function") or {}
                    name = str(function.get("name") or "unknown")
                    try:
                        arguments = json.loads(function.get("arguments") or "{}")
                    except (TypeError, json.JSONDecodeError):
                        arguments = {}
                    if not isinstance(arguments, dict):
                        arguments = {}
                    context.append(
                        (
                            6,
                            order,
                            f"- [context] call {name} {_source_label(name, arguments)}",
                        )
                    )
                    order += 1
            else:
                text = _one_line(str(message.get("content") or ""), 240)
                if text:
                    context.append((5, order, f"- [context] assistant: {text}"))
                    order += 1
            continue

        if role != "tool":
            continue

        call_id = str(message.get("tool_call_id"))
        name, arguments = tool_calls.get(call_id, ("unknown", {}))
        source = _source_label(name, arguments)
        content = str(message.get("content") or "")
        before_count = len(evidence)
        evidence.extend(
            _observation_evidence(
                tool_name=name,
                source=source,
                content=content,
                focus_terms=focus_terms,
                start_order=order,
            )
        )
        order += max(1, len(evidence) - before_count)

    evidence = _deduplicate_ranked(evidence)
    context = _deduplicate_ranked(context)
    body = _assemble_summary_body(evidence, context, max_chars=max_chars)
    body_lines = set(body.splitlines())
    evidence_bullets = [
        item[2] for item in evidence if item[2] in body_lines
    ]
    return body, evidence_bullets


def _observation_evidence(
    *,
    tool_name: str,
    source: str,
    content: str,
    focus_terms: list[str],
    start_order: int,
) -> list[tuple[int, int, str]]:
    results: list[tuple[int, int, str]] = []
    order = start_order
    if not content.strip():
        return [(4, order, f"- [tool={tool_name} {source}] empty observation")]

    metadata: dict[str, str] = {}
    raw_lines = content.splitlines()
    for line in raw_lines:
        stripped = line.strip()
        key, separator, value = stripped.partition(":")
        if separator and key in {
            "total_lines",
            "requested_range",
            "returned_range",
            "has_more",
            "next_start_line",
            "file_has_more",
            "budget_limited",
        }:
            metadata[key] = value.strip()

    metadata_parts = []
    if metadata.get("returned_range"):
        metadata_parts.append(f"returned_range={metadata['returned_range']}")
    if metadata.get("next_start_line"):
        metadata_parts.append(f"next_start_line={metadata['next_start_line']}")
    if metadata.get("has_more"):
        metadata_parts.append(f"has_more={metadata['has_more']}")
    if metadata.get("file_has_more"):
        metadata_parts.append(f"file_has_more={metadata['file_has_more']}")
    if metadata_parts:
        results.append(
            (
                3,
                order,
                f"- [tool={tool_name} {source}] " + " ".join(metadata_parts),
            )
        )
        order += 1

    tool_fallback: list[tuple[int, str]] = []
    for raw_line in raw_lines:
        stripped = raw_line.rstrip()
        if not stripped or stripped == "---":
            continue
        if any(stripped.startswith(f"{key}:") for key in metadata):
            continue
        line_number = None
        text = stripped
        prefixed = _LINE_PREFIX_RE.match(stripped)
        if prefixed:
            line_number = int(prefixed.group(1))
            text = prefixed.group(2).rstrip()
        else:
            grep_prefixed = _GREP_LINE_RE.match(stripped)
            if grep_prefixed:
                line_number = int(grep_prefixed.group(1))
                text = grep_prefixed.group(2).rstrip()
        if not text:
            continue

        priority = None
        if any(term in text for term in focus_terms):
            priority = 0
        elif _ERROR_RE.search(text):
            priority = 1
        elif _TODO_RE.search(text):
            priority = 2
        elif _UPPER_ASSIGNMENT_RE.search(text):
            priority = 3
        if priority is None:
            tool_fallback.append((order, text))
            order += 1
            continue

        location = f" line={line_number}" if line_number is not None else ""
        results.append(
            (
                priority,
                order,
                f"- [tool={tool_name} {source}]{location} {text}",
            )
        )
        order += 1

    if not results:
        selected = tool_fallback[:4]
        for _, text in selected:
            results.append((4, order, f"- [tool={tool_name} {source}] {text}"))
            order += 1
    return results


def _deduplicate_ranked(
    items: list[tuple[int, int, str]],
) -> list[tuple[int, int, str]]:
    seen: set[str] = set()
    unique = []
    for item in sorted(items, key=lambda value: (value[1], value[0])):
        if item[2] in seen:
            continue
        seen.add(item[2])
        unique.append(item)
    return sorted(unique, key=lambda value: (value[0], value[1]))


def _assemble_summary_body(
    evidence: list[tuple[int, int, str]],
    context: list[tuple[int, int, str]],
    *,
    max_chars: int,
) -> str:
    header = "older context compacted; exact evidence takes priority.\nEVIDENCE:\n"
    footer_context = "CONTEXT:\n"
    evidence_lines: list[str] = []
    context_lines: list[str] = []
    minimum_footer = len(footer_context)
    for _, _, line in evidence:
        candidate_extra = len(line) + (1 if evidence_lines else 0)
        if len(header) + sum(len(item) + 1 for item in evidence_lines) + candidate_extra > (
            max_chars - 120
        ):
            continue
        evidence_lines.append(line)
    if not evidence_lines:
        evidence_lines.append("- [tool=summary] no extractable evidence")
    for _, _, line in context:
        projected = (
            len(header)
            + sum(len(item) + 1 for item in evidence_lines)
            + minimum_footer
            + sum(len(item) + 1 for item in context_lines)
            + len(line)
            + 1
        )
        if projected <= max_chars - 80:
            context_lines.append(line)
    body = header + "\n".join(evidence_lines) + "\n"
    if context_lines:
        body += footer_context + "\n".join(context_lines) + "\n"
    return body


def _format_summary(strategy: str, body: str, max_chars: int) -> str:
    marker = f"{COMPACTED_HISTORY_MARKER} strategy={strategy}]"
    remaining = max_chars - len(marker) - 1
    clipped = body.strip()
    if len(clipped) > remaining:
        clipped = clipped[: max(0, remaining)]
    return f"{marker}\n{clipped}".rstrip()


def _summary_message(strategy: str, body: str, max_chars: int) -> dict[str, Any]:
    return {
        "role": "system",
        "content": _format_summary(strategy, body, max_chars),
    }


def _render_transcript(messages: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    calls = _tool_call_map(messages)
    for message in messages:
        role = message.get("role")
        if role == "tool":
            call_id = str(message.get("tool_call_id"))
            name, arguments = calls.get(call_id, ("unknown", {}))
            blocks.append(
                f"TOOL {name} {_source_label(name, arguments)}:\n"
                f"{message.get('content') or ''}"
            )
        elif role == "assistant" and message.get("tool_calls"):
            for call in message["tool_calls"]:
                function = call.get("function") or {}
                blocks.append(
                    "CALL "
                    f"{function.get('name')} {function.get('arguments')}"
                )
        else:
            blocks.append(f"{str(role).upper()}:\n{message.get('content') or ''}")
    return "\n\n".join(blocks)


def _missing_required_facts(model_summary: str, evidence_ledger: str) -> list[str]:
    """Check exact high-signal facts without requiring a verbatim ledger.

    The model may reorganize prose, but source paths, tool names, continuation
    metadata, line anchors, uppercase assignments, errors, and TODOs must remain
    byte-for-byte discoverable in the summary.
    """

    required: list[str] = []
    for line in evidence_ledger.splitlines():
        stripped = line.strip()
        if not stripped.startswith("- [tool="):
            continue

        source_match = re.search(
            r"\[tool=([^ ]+).*?\b(?:file_path|dir_path|root|path)=([^ \]]+)",
            stripped,
        )
        if source_match:
            required.extend((source_match.group(1), source_match.group(2)))

        for metadata in re.finditer(
            r"\b(returned_range|next_start_line|has_more|file_has_more)=([^ \]]+)",
            stripped,
        ):
            required.append(f"{metadata.group(1)}={metadata.group(2)}")

        for line_match in re.finditer(r"\bline=(\d+)\b", stripped):
            required.append(f"line={line_match.group(1)}")

        payload = stripped.rsplit("]", 1)[-1].strip()
        if payload and (
            _ERROR_RE.search(payload)
            or _TODO_RE.search(payload)
            or _UPPER_ASSIGNMENT_RE.search(payload)
        ):
            required.append(payload)

    return [fact for fact in dict.fromkeys(required) if fact not in model_summary]


def _one_line(text: str, limit: int) -> str:
    value = " ".join(text.split())
    return value if len(value) <= limit else value[: limit - 1] + "…"
