from __future__ import annotations

import os
import shlex
import subprocess
import sys
from pathlib import Path

from tools.spec import ToolRegistry, ToolSpec


class WorkspaceBoundaryError(PermissionError):
    pass


class Workspace:
    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()
        if not self.root.is_dir():
            raise ValueError(f"工作目录不存在：{self.root}")

    def resolve(self, value: str) -> Path:
        raw = Path(value).expanduser()
        candidate = raw.resolve() if raw.is_absolute() else (self.root / raw).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise WorkspaceBoundaryError(
                f"路径越权：{value!r} 不在工作目录 {self.root}"
            ) from exc
        return candidate

    def relative(self, path: Path) -> str:
        return str(path.resolve().relative_to(self.root))


def _process_env(workspace: Path) -> dict[str, str]:
    """Keep only a small environment for local child processes.

    This reduces accidental secret exposure but is not OS-level isolation.
    """
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(workspace),
        "TMPDIR": str(workspace),
        "PYTHONIOENCODING": "utf-8",
        "LANG": os.environ.get("LANG", "C.UTF-8"),
    }
    return {key: value for key, value in env.items() if value}


def _format_process_output(exit_code: int, stdout: str, stderr: str) -> str:
    return (
        f"exit_code: {exit_code}\n"
        f"stdout:\n{stdout.rstrip()}\n"
        f"stderr:\n{stderr.rstrip()}"
    ).rstrip()


def build_registry(
    workspace_path: Path,
    *,
    max_observation_chars: int = 4000,
    shell_timeout_seconds: float = 10.0,
    python_timeout_seconds: float = 10.0,
) -> ToolRegistry:
    workspace = Workspace(workspace_path)
    registry = ToolRegistry(workspace.root, max_observation_chars)

    def ls(dir_path: str = ".") -> str:
        target = workspace.resolve(dir_path)
        if not target.is_dir():
            raise NotADirectoryError(f"不是目录：{dir_path}")
        entries = sorted(target.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))
        if not entries:
            return "目录为空"
        return "\n".join(
            f"[DIR] {workspace.relative(entry)}" if entry.is_dir()
            else f"[FILE] {workspace.relative(entry)}"
            for entry in entries
        )

    def read_file(
        file_path: str,
        start_line: int | None = None,
        end_line: int | None = None,
    ) -> str:
        target = workspace.resolve(file_path)
        if not target.is_file():
            raise FileNotFoundError(f"文件不存在：{file_path}")
        raw = target.read_text(encoding="utf-8")
        lines = raw.splitlines()
        if not lines:
            return "文件为空"

        start = 1 if start_line is None else start_line
        end = len(lines) if end_line is None else end_line
        if start < 1 or end < 1:
            raise ValueError("start_line 和 end_line 必须大于等于 1")
        if end < start:
            raise ValueError("end_line 不能小于 start_line")
        if start > len(lines):
            raise ValueError(f"start_line={start} 超出文件总行数 {len(lines)}")

        selected = lines[start - 1 : min(end, len(lines))]
        numbered = "\n".join(
            f"{line_number:>6}\t{line}"
            for line_number, line in enumerate(selected, start=start)
        )
        return (
            f"total_lines: {len(lines)}\n"
            f"ends_with_newline: {str(raw.endswith(chr(10))).lower()}\n"
            f"---\n{numbered}"
        )

    def write_file(file_path: str, content: str) -> str:
        target = workspace.resolve(file_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"写入成功：{workspace.relative(target)}（{len(content)} 字符）"

    def grep(file_path: str, pattern: str) -> str:
        target = workspace.resolve(file_path)
        if not target.is_file():
            raise FileNotFoundError(f"文件不存在：{file_path}")
        matches = []
        for line_number, line in enumerate(
            target.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if pattern in line:
                matches.append(f"{line_number}: {line}")
        return "\n".join(matches) if matches else "没有匹配结果"

    def find(root: str, name_pattern: str) -> str:
        root_path = workspace.resolve(root)
        if not root_path.is_dir():
            raise NotADirectoryError(f"不是目录：{root}")
        results = []
        for path in root_path.rglob(f"*{name_pattern}*"):
            if not path.is_file():
                continue
            try:
                results.append(workspace.relative(path))
            except (ValueError, WorkspaceBoundaryError):
                continue
        return "\n".join(sorted(results)) if results else "没有找到文件"

    def run_shell(cmd: str) -> str:
        argv = shlex.split(cmd)
        if not argv:
            raise ValueError("命令不能为空")
        try:
            completed = subprocess.run(
                argv,
                cwd=workspace.root,
                capture_output=True,
                text=True,
                timeout=shell_timeout_seconds,
                env=_process_env(workspace.root),
            )
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout or ""
            stderr = exc.stderr or ""
            raise TimeoutError(
                f"命令超过 {shell_timeout_seconds:g} 秒\n{_format_process_output(-1, stdout, stderr)}"
            ) from exc
        return _format_process_output(
            completed.returncode, completed.stdout, completed.stderr
        )

    def run_python(code: str) -> str:
        try:
            completed = subprocess.run(
                [sys.executable, "-I", "-c", code],
                cwd=workspace.root,
                capture_output=True,
                text=True,
                timeout=python_timeout_seconds,
                env=_process_env(workspace.root),
            )
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout or ""
            stderr = exc.stderr or ""
            raise TimeoutError(
                f"Python 超过 {python_timeout_seconds:g} 秒\n"
                f"{_format_process_output(-1, stdout, stderr)}"
            ) from exc
        return _format_process_output(
            completed.returncode, completed.stdout, completed.stderr
        )

    registry.register(
        ToolSpec(
            name="ls",
            description="列出工作目录中的文件和子目录。",
            parameters={
                "type": "object",
                "properties": {
                    "dir_path": {
                        "type": "string",
                        "description": "相对工作目录的路径，默认 .",
                    }
                },
                "required": [],
            },
            handler=ls,
        )
    )
    registry.register(
        ToolSpec(
            name="read_file",
            description="读取工作目录内文本文件，可按行号范围读取以减少上下文。",
            parameters={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "相对工作目录的文件路径"},
                    "start_line": {"type": "integer", "minimum": 1},
                    "end_line": {"type": "integer", "minimum": 1},
                },
                "required": ["file_path"],
            },
            handler=read_file,
        )
    )
    registry.register(
        ToolSpec(
            name="write_file",
            description="创建或覆盖工作目录内文本文件。执行前需要用户批准。",
            parameters={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["file_path", "content"],
            },
            handler=write_file,
            requires_approval=True,
            risk="write",
        )
    )
    registry.register(
        ToolSpec(
            name="grep",
            description="在单个文本文件中进行字面量搜索并返回匹配行。",
            parameters={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string"},
                    "pattern": {"type": "string"},
                },
                "required": ["file_path", "pattern"],
            },
            handler=grep,
        )
    )
    registry.register(
        ToolSpec(
            name="find",
            description="在工作目录中递归查找文件名包含指定文本的文件。",
            parameters={
                "type": "object",
                "properties": {
                    "root": {"type": "string"},
                    "name_pattern": {"type": "string"},
                },
                "required": ["root", "name_pattern"],
            },
            handler=find,
        )
    )
    registry.register(
        ToolSpec(
            name="run_shell",
            description=(
                "以 argv 方式执行本地命令，不做 shell 展开；工作目录受限，但仍需用户批准。"
            ),
            parameters={
                "type": "object",
                "properties": {"cmd": {"type": "string"}},
                "required": ["cmd"],
            },
            handler=run_shell,
            requires_approval=True,
            risk="execute",
        )
    )
    registry.register(
        ToolSpec(
            name="run_python",
            description=(
                "在独立 Python 子进程中执行代码并返回 stdout/stderr；"
                "不是安全沙箱，执行前需要用户批准。"
            ),
            parameters={
                "type": "object",
                "properties": {"code": {"type": "string"}},
                "required": ["code"],
            },
            handler=run_python,
            requires_approval=True,
            risk="execute",
        )
    )
    return registry
