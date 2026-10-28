from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class ModelConfig:
    provider: str
    base_url: str
    api_key: str
    model: str
    request_timeout_seconds: float = 120.0


@dataclass(frozen=True)
class HarnessConfig:
    workspace: Path
    max_steps: int = 8
    max_observation_chars: int = 4000
    context_window_tokens: int = 32768
    shell_timeout_seconds: float = 10.0
    python_timeout_seconds: float = 10.0
    trace_dir: Path = Path("traces")


def _float_env(env: dict[str, str], key: str, default: float) -> float:
    raw = env.get(key)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"{key} 必须是数字，当前值：{raw!r}") from exc


def _int_env(env: dict[str, str], key: str, default: int) -> int:
    raw = env.get(key)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{key} 必须是整数，当前值：{raw!r}") from exc


def load_model_config(
    env: dict[str, str] | None = None,
    *,
    provider: str | None = None,
    model: str | None = None,
) -> ModelConfig:
    if env is None:
        load_dotenv()
        env = dict(os.environ)

    provider_name = (provider or env.get("MODEL_PROVIDER", "local")).strip().lower()
    if provider_name == "local":
        base_url = env.get("LOCAL_BASE_URL", "http://127.0.0.1:11434/v1")
        api_key = env.get("LOCAL_API_KEY", "dummy")
        model_name = model or env.get("LOCAL_MODEL", "glm-4.7-flash:latest")
    elif provider_name in {"cloud", "deepseek"}:
        provider_name = "cloud"
        base_url = env.get("CLOUD_BASE_URL", "https://api.deepseek.com")
        api_key = env.get("CLOUD_API_KEY") or env.get("DEEPSEEK_API_KEY", "")
        model_name = model or env.get("CLOUD_MODEL", "deepseek-chat")
        if not api_key:
            raise ValueError("cloud 模式需要 CLOUD_API_KEY 或 DEEPSEEK_API_KEY")
    else:
        raise ValueError(f"不支持的 MODEL_PROVIDER：{provider_name!r}")

    return ModelConfig(
        provider=provider_name,
        base_url=base_url.rstrip("/"),
        api_key=api_key,
        model=model_name,
        request_timeout_seconds=_float_env(env, "REQUEST_TIMEOUT_SECONDS", 120.0),
    )


def load_harness_config(
    env: dict[str, str] | None = None,
    *,
    workspace: str | Path | None = None,
    max_steps: int | None = None,
) -> HarnessConfig:
    if env is None:
        load_dotenv()
        env = dict(os.environ)

    workspace_value = workspace or env.get("WORKSPACE") or Path.cwd()
    workspace_path = Path(workspace_value).expanduser().resolve()
    if not workspace_path.exists() or not workspace_path.is_dir():
        raise ValueError(f"WORKSPACE 必须是已存在的目录：{workspace_path}")

    trace_value = env.get("TRACE_DIR", "traces")
    trace_dir = Path(trace_value).expanduser()
    if not trace_dir.is_absolute():
        trace_dir = (Path.cwd() / trace_dir).resolve()

    resolved_max_steps = max_steps if max_steps is not None else _int_env(env, "MAX_STEPS", 8)
    if resolved_max_steps < 1:
        raise ValueError("MAX_STEPS 必须大于 0")

    max_observation_chars = _int_env(env, "MAX_OBSERVATION_CHARS", 4000)
    if max_observation_chars < 1:
        raise ValueError("MAX_OBSERVATION_CHARS 必须大于 0")

    context_window_tokens = _int_env(env, "CONTEXT_WINDOW_TOKENS", 32768)
    if context_window_tokens < 1:
        raise ValueError("CONTEXT_WINDOW_TOKENS 必须大于 0")

    return HarnessConfig(
        workspace=workspace_path,
        max_steps=resolved_max_steps,
        max_observation_chars=max_observation_chars,
        context_window_tokens=context_window_tokens,
        shell_timeout_seconds=_float_env(env, "SHELL_TIMEOUT_SECONDS", 10.0),
        python_timeout_seconds=_float_env(env, "PYTHON_TIMEOUT_SECONDS", 10.0),
        trace_dir=trace_dir,
    )
