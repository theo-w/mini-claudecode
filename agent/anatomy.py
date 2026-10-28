from __future__ import annotations

import copy
import inspect
from pathlib import Path
from typing import Any

from tools.spec import ToolRegistry


ROOT = Path(__file__).resolve().parent.parent

MODULES: tuple[dict[str, Any], ...] = (
    {
        "id": "model",
        "name": "Model Provider",
        "kind": "decision",
        "summary": "接收 messages 与工具 Schema，返回文本或结构化 tool calls，并提供真实 Token usage。",
        "source": {"path": "providers/openai_compat.py", "line": 1},
        "inputs": ["messages", "tool schemas", "model config"],
        "outputs": ["assistant content", "tool_calls", "usage"],
        "connects_to": ["loop", "context"],
    },
    {
        "id": "loop",
        "name": "Agent Loop",
        "kind": "control",
        "summary": "控制模型轮次、工具调度、observation 回写、下一轮压缩与停止条件。",
        "source": {"path": "agent/loop.py", "line": 1},
        "inputs": ["user task", "assistant turn", "max_steps"],
        "outputs": ["tool dispatch", "messages", "run status"],
        "connects_to": ["model", "tools", "approval", "compaction", "trace"],
    },
    {
        "id": "tools",
        "name": "Tool Registry",
        "kind": "capability",
        "summary": "注册工具契约，校验参数，执行 handler，并限制返回 observation 的字符预算。",
        "source": {"path": "tools/spec.py", "line": 1},
        "inputs": ["tool name", "JSON arguments"],
        "outputs": ["ToolResult", "observation"],
        "connects_to": ["loop", "approval"],
    },
    {
        "id": "approval",
        "name": "Approval Gate",
        "kind": "guardrail",
        "summary": "在写入或执行型工具前应用 Harness 审批策略；审批不等同于系统隔离。",
        "source": {"path": "agent/approval.py", "line": 1},
        "inputs": ["ApprovalRequest", "risk"],
        "outputs": ["approved", "approval_denied"],
        "connects_to": ["tools", "trace"],
    },
    {
        "id": "context",
        "name": "Context Inspector",
        "kind": "state",
        "summary": "统计消息、字符、工具 observation 和摘要占用；字符指标不等于 Token。",
        "source": {"path": "agent/context.py", "line": 1},
        "inputs": ["messages"],
        "outputs": ["context snapshot", "observation metrics"],
        "connects_to": ["model", "compaction", "trace"],
    },
    {
        "id": "compaction",
        "name": "History Compaction",
        "kind": "state",
        "summary": "在下一轮模型请求前按真实 prompt Token 触发压缩，支持确定性摘要、模型摘要与回退。",
        "source": {"path": "agent/compaction.py", "line": 1},
        "inputs": ["messages", "prompt_tokens", "strategy"],
        "outputs": ["compacted messages", "evidence summary", "fallback"],
        "connects_to": ["loop", "context", "trace"],
    },
    {
        "id": "trace",
        "name": "Event Trace",
        "kind": "evidence",
        "summary": "按时间记录真实事件，为 Loop 回放与失败分析提供证据，而非依赖模型自我描述。",
        "source": {"path": "agent/trace.py", "line": 1},
        "inputs": ["structured events"],
        "outputs": ["JSONL trace", "session events"],
        "connects_to": ["eval"],
    },
    {
        "id": "eval",
        "name": "Fixed-task Eval",
        "kind": "evidence",
        "summary": "在独立临时目录运行固定任务，汇总 checks、Token、上下文、成本与 group 指标。",
        "source": {"path": "scripts/run_eval.py", "line": 1},
        "inputs": ["task definitions", "run config", "events"],
        "outputs": ["Eval JSON", "checks", "aggregates"],
        "connects_to": ["trace"],
    },
)


def _repo_source(handler: Any) -> dict[str, Any]:
    try:
        source_path = Path(inspect.getsourcefile(handler) or inspect.getfile(handler)).resolve()
        line = inspect.getsourcelines(handler)[1]
    except (OSError, TypeError):
        return {"path": "unknown", "line": None}

    try:
        path = source_path.relative_to(ROOT).as_posix()
    except ValueError:
        path = source_path.as_posix()
    return {"path": path, "line": line}


def build_catalog(registry: ToolRegistry) -> dict[str, Any]:
    tools = []
    for spec in registry.specs:
        tools.append(
            {
                "name": spec.name,
                "description": spec.description,
                "parameters": copy.deepcopy(spec.parameters),
                "requires_approval": spec.requires_approval,
                "risk": spec.risk,
                "source": _repo_source(spec.handler),
                "registry_source": {"path": "tools/spec.py", "line": 1},
                "architecture": "Model → Agent Loop → Approval? → ToolRegistry → handler → observation",
            }
        )
    return {"modules": copy.deepcopy(list(MODULES)), "tools": tools}
