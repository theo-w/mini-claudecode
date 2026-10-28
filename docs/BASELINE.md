# v0.2.1 Harness Baseline

## 目的

这份记录不是“Agent 已经稳定”的证明，而是后续实验的第一条时间线。它固定当前任务集、模型、指标和运行边界，方便在修改 Prompt、上下文策略、工具或模型后进行对照。

## 基线信息

- 日期：2026-10-28
- 代码起点：`1901a31`（v0.2）
- 版本：v0.2.1 Harness Baseline
- Provider：本地 OpenAI 兼容接口
- 模型：`glm-4.7-flash:latest`
- 任务集：`evals/tasks.json`，10 个固定任务
- 结果文件：`evals/results/eval-20261028-083259.json`（本地生成，不提交 Git）

## 单次结果

| 指标 | 结果 |
|---|---:|
| 任务通过 | 10 / 10 |
| 成功率 | 100% |
| 平均模型轮次 | 2.50 |
| 最少 / 最多轮次 | 2 / 5 |
| 总耗时 | 146.42 秒 |
| 工具错误 | 1 |

唯一的工具错误来自任务 08：模型按要求读取 `missing.txt`，工具返回真实的不存在错误，模型随后正确报告失败。这个错误是评测预期，不是 Harness 故障。

每条任务的通过判定同时要求：

1. Agent Loop 正常结束；
2. 对应工具调用存在且结果符合预期；
3. 最终输出包含目标信息；
4. 文件类任务的实际文件内容正确。

因此，“模型说自己完成了”本身不会让任务通过。

## 如何复现

```bash
python3 -m unittest discover -s tests -v
python3 scripts/run_eval.py
```

第一条命令是确定性测试，不依赖模型。第二条命令调用真实模型，结果会写入 `evals/results/`。

## 正确解读

- 10/10 是**一次本地运行快照**，不是稳定成功率保证。
- 固定 10 个任务规模较小，存在过拟合和覆盖面不足的风险。
- 当前没有 Token 统计，只有字符截断和模型轮次。
- 评测会使用 `AutoApprove`，因为它只操作一次性临时目录；这不代表交互模式也自动批准。
- 工具错误只统计 `tool_result` 中失败的调用，尚未区分预期错误和意外错误。
- `run_shell` / `run_python` 仍具备宿主访问能力，只是位于工作目录和审批 Guardrail 之后，不是 Sandbox。

## 下一轮实验

进入 M1 前先保持这组任务不变，增加以下记录：

- 每轮输入/输出 Token 与上下文字符数；
- 长文件任务在整文件读取、分页读取和摘要压缩下的成功率；
- 重复运行的成功率分布，而不只记录最好的一次。

M1 的结论应回答“上下文在什么条件下开始失真或耗尽”，而不是只证明新增了一个压缩函数。

## 对应 SDD 文档

本次基线对应的需求、方案、任务和实施证据：

- [Spec](specs/v0.2.1-harness-baseline/spec.md)
- [Plan](specs/v0.2.1-harness-baseline/plan.md)
- [Tasks](specs/v0.2.1-harness-baseline/tasks.md)
- [Implement](specs/v0.2.1-harness-baseline/implement.md)
