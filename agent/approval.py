from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class ApprovalRequest:
    tool_name: str
    arguments: dict
    risk: str


ApprovalPolicy = Callable[[ApprovalRequest], bool]


class AutoApprove:
    def __call__(self, request: ApprovalRequest) -> bool:
        return True


class DenyAll:
    def __call__(self, request: ApprovalRequest) -> bool:
        return False


class InteractiveApproval:
    """Asks the local user before write or execution tools run."""

    def __call__(self, request: ApprovalRequest) -> bool:
        print("\n⚠️  工具需要确认")
        print(f"工具：{request.tool_name}")
        print(f"风险：{request.risk}")
        print(f"参数：{request.arguments}")
        try:
            answer = input("允许执行？[y/N] ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return False
        return answer in {"y", "yes"}
