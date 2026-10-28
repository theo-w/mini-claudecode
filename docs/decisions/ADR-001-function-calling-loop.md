# ADR-001：使用原生 Function Calling Loop

状态：Accepted

## 背景

项目目标是理解 Agent，而不是快速获得一个可用的 Agent 框架能力。候选方案包括直接使用 LangGraph/Agent SDK、自写 Text ReAct Parser，或基于 OpenAI 兼容 Function Calling 手写循环。

## 决策

使用 OpenAI 兼容的 Function Calling 协议手写最小 Agent Loop。

循环职责：

1. 发送消息和工具 Schema
2. 接收 assistant tool_calls
3. 校验参数和审批
4. 执行工具
5. 将 tool message 与调用 ID 配对
6. 继续调用模型，直到完成、失败或达到最大步数

## 理由

- 可以直接学习 Agent 最核心的运行契约
- Tool Call 是结构化协议，比自然语言 ReAct 解析更可靠
- 没有框架黑盒，便于插入 Trace、审批和评测
- 后续仍可切换或引入框架，不影响对原理的理解

## 后果

- 需要自行处理上下文、重试、并发和错误语义
- 不能把当前实现称为完整 ReAct；它更准确地说是 Function Calling Agent Loop
- 框架能省掉的工程问题，正好是本项目要学习的内容
