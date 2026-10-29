from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

from agent.approval import AutoApprove, InteractiveApproval
from agent.config import load_harness_config, load_model_config
from agent.loop import AgentLoop, initial_messages
from agent.trace import EventTracer
from providers.openai_compat import OpenAICompatibleProvider
from tools.builtin import build_registry


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mini Agent Harness v0.10.0")
    parser.add_argument("--provider", choices=["local", "cloud"], help="覆盖 MODEL_PROVIDER")
    parser.add_argument("--model", help="覆盖当前 provider 的模型名")
    parser.add_argument("--workspace", help="允许 Agent 访问的根目录")
    parser.add_argument("--max-steps", type=int, help="单次任务最大模型轮次")
    parser.add_argument(
        "--context-window-tokens",
        type=int,
        help="覆盖上下文窗口预算",
    )
    parser.add_argument(
        "--compaction-strategy",
        choices=["off", "extractive", "model"],
        help="覆盖历史压缩策略",
    )
    parser.add_argument(
        "--compaction-trigger-tokens",
        type=int,
        help="覆盖历史压缩触发 Token",
    )
    parser.add_argument(
        "--compaction-keep-recent-messages",
        type=int,
        help="覆盖最近消息保留条数",
    )
    parser.add_argument(
        "--compaction-max-summary-chars",
        type=int,
        help="覆盖摘要字符上限",
    )
    parser.add_argument(
        "--auto-approve",
        action="store_true",
        help="自动批准写文件和执行工具；只应在隔离目录中使用",
    )
    return parser.parse_args()


def print_event(event: dict) -> None:
    kind = event.get("event")
    if kind == "tool_call":
        print(f"\n🔧 {event['tool']} {event['arguments']}")
    elif kind == "tool_result":
        state = "OK" if event["ok"] else "ERROR"
        print(f"📄 observation [{state}, {event['duration_ms']}ms]")
        print(event["content"])
    elif kind == "approval_denied":
        print(f"\n⛔ 已拒绝工具：{event['tool']}")
    elif kind == "invalid_tool_arguments":
        print(f"\n⚠️ 工具参数无效：{event['error']}")
    elif kind == "model_response":
        usage = event.get("usage")
        ratio = event.get("context_usage_ratio")
        ratio_text = f", {ratio:.2%} window" if ratio is not None else ""
        if usage:
            print(
                f"🧠 step {event['step']}: context {event['context_chars']:,} chars"
                f"{ratio_text}, "
                f"tokens {usage['prompt_tokens']}/{usage['completion_tokens']}"
            )
        else:
            print(
                f"🧠 step {event['step']}: context {event['context_chars']:,} chars"
                f"{ratio_text}, tokens n/a"
            )
    elif kind == "model_error":
        print(f"\n❌ 模型调用失败：{event['error']}")
    elif kind == "history_compaction":
        if event.get("compacted"):
            fallback = event.get("fallback_reason")
            fallback_text = f", fallback={fallback}" if fallback else ""
            print(
                "\n🗜️ 历史压缩："
                f"{event['effective_strategy']} "
                f"trigger={event['trigger_prompt_tokens']:,} tokens, "
                f"{event['messages_before']}->{event['messages_after']} messages, "
                f"{event['context_chars_before']:,}->{event['context_chars_after']:,} chars"
                f"{fallback_text}"
            )
        elif event.get("reason") == "usage_unavailable":
            print("\n🗜️ 历史压缩跳过：Provider 未返回 prompt usage")
    elif kind == "compaction_model_error":
        print(f"\n⚠️ 摘要模型调用失败，将回退确定性摘要：{event['error']}")


def main() -> int:
    args = parse_args()
    try:
        model_config = load_model_config(provider=args.provider, model=args.model)
        harness_config = load_harness_config(
            workspace=args.workspace,
            max_steps=args.max_steps,
            context_window_tokens=args.context_window_tokens,
            compaction_strategy=args.compaction_strategy,
            compaction_trigger_tokens=args.compaction_trigger_tokens,
            compaction_keep_recent_messages=args.compaction_keep_recent_messages,
            compaction_max_summary_chars=args.compaction_max_summary_chars,
        )
    except ValueError as exc:
        print(f"配置错误：{exc}")
        return 2

    provider = OpenAICompatibleProvider(model_config)
    registry = build_registry(
        harness_config.workspace,
        max_observation_chars=harness_config.max_observation_chars,
        shell_timeout_seconds=harness_config.shell_timeout_seconds,
        python_timeout_seconds=harness_config.python_timeout_seconds,
    )
    trace_name = f"session-{datetime.now().strftime('%Y%m%d-%H%M%S')}.jsonl"
    tracer = EventTracer(harness_config.trace_dir / trace_name)
    approval = AutoApprove() if args.auto_approve else InteractiveApproval()
    agent = AgentLoop(
        provider=provider,
        registry=registry,
        tracer=tracer,
        max_steps=harness_config.max_steps,
        approval_policy=approval,
        context_window_tokens=harness_config.context_window_tokens,
        compaction_strategy=harness_config.compaction_strategy,
        compaction_trigger_tokens=harness_config.compaction_trigger_tokens,
        compaction_keep_recent_messages=harness_config.compaction_keep_recent_messages,
        compaction_max_summary_chars=harness_config.compaction_max_summary_chars,
        on_event=print_event,
    )

    print("===== Mini Agent Harness v0.10.0 =====")
    print(f"模型：{model_config.provider}/{model_config.model}")
    print(f"工作目录：{harness_config.workspace}")
    print(f"上下文窗口预算：{harness_config.context_window_tokens:,} tokens")
    if harness_config.compaction_strategy == "off":
        print("历史压缩：off")
    else:
        print(
            "历史压缩："
            f"{harness_config.compaction_strategy}, "
            f"触发 {harness_config.compaction_trigger_tokens:,} tokens, "
            f"保留最近 {harness_config.compaction_keep_recent_messages} 条消息"
        )
    print(f"单次 observation 预算：{harness_config.max_observation_chars:,} chars")
    print(f"Trace：{tracer.output_path}")
    print("工具：ls, read_file, write_file, grep, find, run_shell, run_python")
    if args.auto_approve:
        print("⚠️ 已开启自动批准，仅建议在隔离目录中使用")
    else:
        print("写文件和执行命令前会请求本地确认")
    print("命令：clear 清空上下文 | exit 退出\n")

    messages = initial_messages()
    while True:
        try:
            user_input = input("📝 任务 > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n👋 退出")
            break

        command = user_input.lower()
        if command in {"exit", "quit"}:
            print("👋 退出")
            break
        if command == "clear":
            messages = initial_messages()
            print("🧹 上下文已清空\n")
            continue
        if not user_input:
            continue

        messages.append({"role": "user", "content": user_input})
        result = agent.run(messages)
        if result.final_text:
            print(f"\n🤖 Agent：\n{result.final_text}\n")
        elif result.error:
            print(f"\nAgent 未完成：{result.error}\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
