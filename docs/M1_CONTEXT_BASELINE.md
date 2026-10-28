# M1.1 Context Budget Baseline

## 目的

这份记录固定 M1 的第一条上下文实验基线：先让上下文使用量、长文件分页和续读行为可观测，再比较“从头扫描”和“先 grep 定位再读取”的差异。

它不是 M1 的完成证明。历史压缩、摘要失真和重复运行稳定性仍属于后续实验。

## 基线信息

- 日期：2026-10-28
- 代码起点：`7bb0c0f`（v0.2.1 Harness Baseline）
- 当前版本：v0.3.0 M1.1 Context Budget
- Provider：`cloud`
- 模型：`deepseek-chat`
- 上下文窗口配置：32,768 tokens
- 单条 observation 预算：4,000 chars
- M1 任务集：`evals/m1_tasks.json`，5 个固定任务
- 回归任务集：`evals/tasks.json`，10 个固定任务
- 结果文件（本地生成，不提交 Git）：
  - `evals/results/m1-20261028-091040.json`（M1 最终快照）
  - `evals/results/m1-regression-local-20261028-091130.json`（原任务本地回归）
  - `evals/results/m1-regression-20261028-091100.json`（云端余额耗尽的中止记录，不计入通过证据）

## 本轮新增观测

每次模型请求和响应会记录：

- 序列化后的上下文字符数；
- 消息数量和工具 observation 数量；
- 工具 observation 总字符数与最大单条字符数；
- Provider 返回的 prompt、completion 和 total tokens；
- prompt tokens 占 `CONTEXT_WINDOW_TOKENS` 的比例。

`read_file` 在字符预算内按行分页，并返回：

- `requested_range`；
- `returned_range`；
- `has_more`；
- `next_start_line`；
- `file_has_more` 和 `budget_limited`。

## M1 完整运行快照

| 指标 | 全部任务 | `scan` | `grep_first` | `multi_file` |
|---|---:|---:|---:|---:|
| 通过 | 5 / 5 | 2 / 2 | 2 / 2 | 1 / 1 |
| 成功率 | 100% | 100% | 100% | 100% |
| 平均步数 | 4.00 | 6.00 | 3.00 | 2.00 |
| 总输入 Token | 47,779 | 36,831 | 6,557 | 4,391 |
| 总输出 Token | 1,559 | 911 | 456 | 192 |
| 总 Token | 49,338 | 37,742 | 7,013 | 4,583 |
| 平均峰值上下文字符 | 8,951.4 | 16,224.5 | 1,703.0 | 8,902.0 |
| 平均峰值 prompt Token | 3,417.0 | 5,521.0 | 1,300.5 | 3,442.0 |

完整运行总耗时 18.04 秒，所有任务均拿到 Provider usage，没有缺失 usage 的调用。本轮任务增加了更严格的工具契约：`scan` 不得调用 `grep`，`grep_first` 必须让 `grep` 的调用顺序早于 `read_file`。

### 单任务峰值

| 任务 | 步数 | 输入 Token | 峰值 prompt Token | 峰值上下文占比 | 峰值上下文字符 | 峰值 observation 字符 |
|---|---:|---:|---:|---:|---:|---:|
| `m1_scan_long_file_01` | 6 | 17,753 | 5,109 | 15.59% | 14,763 | 12,323 |
| `m1_scan_long_file_02` | 6 | 19,078 | 5,933 | 18.11% | 17,686 | 14,601 |
| `m1_grep_first_01` | 3 | 3,287 | 1,304 | 3.98% | 1,717 | 548 |
| `m1_grep_first_02` | 3 | 3,270 | 1,297 | 3.96% | 1,689 | 524 |
| `m1_multi_file_context` | 2 | 4,391 | 3,442 | 10.50% | 8,902 | 7,147 |

## 如何解读

在这两个长文件样例上：

- `grep_first` 的平均输入 Token 比 `scan` 少约 82%；
- `grep_first` 的平均步数从 6.00 降到 3.00；
- `grep_first` 的平均峰值上下文字符从 16,224.5 降到 1,703.0；
- `scan` 的 4 次分页虽然都成功，但每页 observation 会继续留在历史消息中，导致后续 prompt 持续增长；
- `multi_file` 说明把多个文件 observation 累积在同一历史中会显著抬高上下文峰值。

这些数字只描述 2 个 `scan`、2 个 `grep_first` 和一个 `multi_file` 任务上的单次探索性运行，不能当作稳定胜率、成本比例或跨模型结论。

## 原基线回归

同一套代码在 `evals/tasks.json`、本地 `glm-4.7-flash:latest` 上重新运行：

| 指标 | 结果 |
|---|---:|
| 通过 | 10 / 10 |
| 平均步数 | 2.40 |
| 总耗时 | 158.44 秒 |
| 总输入 Token | 21,787 |
| 总输出 Token | 1,539 |
| 总 Token | 23,326 |
| 平均峰值上下文字符 | 914.3 |
| 平均峰值 prompt Token | 939.3 |

本轮先尝试云端 `deepseek-chat` 回归，前 7 个任务正常通过，随后 Provider 返回 `402 Insufficient Balance`，剩余 3 个任务都在模型调用前终止。该 7/10 文件只用于记录外部服务故障，不作为代码回归证据。随后使用与历史 v0.2.1 基线相同的本地模型完成 10/10。历史代码与本轮代码、运行批次仍不同，因此不能把 2.40 与历史 2.60 步直接解释成性能提升。

## 如何复现

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q agent providers tools scripts tests main.py
git diff --check

python3 scripts/run_eval.py \
  --tasks evals/m1_tasks.json \
  --provider cloud \
  --model deepseek-chat \
  --output evals/results/m1-manual.json

python3 scripts/run_eval.py \
  --provider local \
  --model glm-4.7-flash:latest \
  --output evals/results/m1-regression-manual.json
```

## 未回答的问题与负面结果

- 本轮 5 个 M1 任务全部通过，没有得到“上下文过载导致失败”的样本，因此还无法判断压缩策略应优先保护哪类信息；
- `scan` 已经使用分页，但没有与“关闭分页、一次完整读取”形成独立对照组；
- 只运行一个模型和一次完整 M1 任务，不能估计运行方差；
- 字符数不是 Token 数，不能替代逐轮 usage；
- 当前只观测上下文，没有自动摘要、历史裁剪或预算触发的中止策略；
- 超过单行 observation 预算的文件仍需要 grep 或调大预算，不能行内续读；
- 所有实验数据均为单个工作日快照，网络、Provider 和模型版本变化都可能改变结果；
- 云端回归在余额耗尽后中止，最终原任务回归来自本地模型，两个 Provider 的数字不能混在一起比较。

## 下一步

建议新开 `m1.2-history-compaction` 规格，回答：

1. 何时触发历史压缩，依据真实 usage 还是字符阈值？
2. 压缩工具 observation、旧轮次还是两者都压缩？
3. 确定性结构化压缩和模型摘要的准确性、Token 成本与可复现性差多少？
4. 压缩后能否保留文件名、行号、错误和“尚未完成”状态？
5. 同一任务重复运行时，成功率、步数和 Token 分布如何变化？

## 对应 SDD 文档

- [Spec](specs/m1.1-context-budget/spec.md)
- [Plan](specs/m1.1-context-budget/plan.md)
- [Tasks](specs/m1.1-context-budget/tasks.md)
- [Implement](specs/m1.1-context-budget/implement.md)

