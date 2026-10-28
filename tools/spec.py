from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


class ToolArgumentError(ValueError):
    pass


@dataclass(frozen=True)
class ToolResult:
    name: str
    ok: bool
    content: str
    duration_ms: float


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., str]
    requires_approval: bool = False
    risk: str = "read"

    def to_openai_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolRegistry:
    def __init__(self, workspace: Path, max_observation_chars: int = 4000) -> None:
        self.workspace = workspace.resolve()
        self.max_observation_chars = max_observation_chars
        self._specs: dict[str, ToolSpec] = {}

    @property
    def specs(self) -> list[ToolSpec]:
        return list(self._specs.values())

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._specs:
            raise ValueError(f"工具重复注册：{spec.name}")
        self._specs[spec.name] = spec

    def get_spec(self, name: str) -> ToolSpec | None:
        return self._specs.get(name)

    def openai_schemas(self) -> list[dict[str, Any]]:
        return [spec.to_openai_schema() for spec in self.specs]

    def invoke(self, name: str, arguments: dict[str, Any]) -> ToolResult:
        started = time.perf_counter()
        spec = self.get_spec(name)
        if spec is None:
            return self._result(name, False, f"ERROR: 未知工具 {name}", started)

        try:
            self._validate_arguments(spec.parameters, arguments)
            raw = spec.handler(**arguments)
            content = raw if isinstance(raw, str) else repr(raw)
            return self._result(name, True, self._truncate(content), started)
        except Exception as exc:
            message = f"ERROR [{type(exc).__name__}]: {exc}"
            return self._result(name, False, self._truncate(message), started)

    def _result(
        self,
        name: str,
        ok: bool,
        content: str,
        started: float,
    ) -> ToolResult:
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        return ToolResult(name=name, ok=ok, content=content, duration_ms=duration_ms)

    def _truncate(self, text: str) -> str:
        if len(text) <= self.max_observation_chars:
            return text
        return text[: self.max_observation_chars] + "\n... [内容截断]"

    def _validate_arguments(self, schema: dict[str, Any], arguments: dict[str, Any]) -> None:
        if not isinstance(arguments, dict):
            raise ToolArgumentError("工具参数必须是 JSON object")

        properties = schema.get("properties", {})
        required = schema.get("required", [])
        missing = [key for key in required if key not in arguments]
        if missing:
            raise ToolArgumentError(f"缺少必填参数：{', '.join(missing)}")

        unexpected = [key for key in arguments if key not in properties]
        if unexpected:
            raise ToolArgumentError(f"存在未声明参数：{', '.join(unexpected)}")

        type_map = {
            "string": str,
            "integer": int,
            "number": (int, float),
            "boolean": bool,
            "array": list,
            "object": dict,
        }
        for key, value in arguments.items():
            expected_name = properties[key].get("type")
            expected_type = type_map.get(expected_name)
            if expected_type is not None and not isinstance(value, expected_type):
                raise ToolArgumentError(
                    f"参数 {key} 类型错误，期望 {expected_name}，实际 {type(value).__name__}"
                )
