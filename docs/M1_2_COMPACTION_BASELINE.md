# M1.2 History Compaction Baseline

## 目的

这份记录固定 M1.2 的第一轮历史压缩基线，回答三个问题：

1. 压缩机制是否能按真实 prompt Token 触发，并保持消息协议合法？
2. 确定性摘要与模型摘要能否在压缩后保留关键证据？
3. 在本轮任务、模型和预算下，压缩是否带来可观察的收益？

结论先行：**三种策略的机制和观测闭环已经跑通，但“压缩提高任务成功率”的假设在本轮没有被证明。** `off` 在 6 个任务中通过 4 个，`extractive` 和 `model` 各通过 3 个。压缩降低了上下文和主模型输入 Token，但在关键证据排序、重复压缩和稳定性上出现了明显失真。

## 基线信息

- 日期：2026-10-28
- 代码起点：`6f47907`（v0.3.0 M1.1 Context Budget）
- 本轮版本：v0.4.0 M1.2 History Compaction
- Provider：`local`
- 模型：`glm-4.7-flash:latest`（Ollama OpenAI 兼容接口）
- 上下文窗口配置：32,768 tokens
- 单条 observation 预算：1,200 chars
- Provider 请求超时：300 秒
- 压缩触发阈值：800 prompt tokens
- 保留最近消息：2 条
- 摘要字符上限：1,600 chars
- Max Steps：由任务定义为 5、10 或 15 步
- 任务集：`evals/m1_2_tasks.json`，6 个固定任务
- 对照策略：`off`、`extractive`、`model`

设置低触发阈值和较窄保留窗口，是为了在短任务中强制发生压缩。因此这组配置描述的是**近窗口压力实验**，不是生产环境推荐默认值。CLI 和 `.env.example` 的默认策略仍为 `off`。

### 结果文件

以下报告由本地评测生成，位于被 Git 忽略的 `evals/results/`，需要时可在本机重新生成：

- `evals/results/m1_2-off-final-20261028.json`
- `evals/results/m1_2-extractive-final-20261028.json`
- `evals/results/m1_2-model-final-20261028.json`
- `evals/results/m1_2-extractive-repeat-20261028.json`

外部服务失败探针：

- `evals/results/m1_2-cloud-probe-20261028.json`

报告包含完整事件、原始 observation、最终输出和逐检查项结果。仓库只提交本文件中的汇总，不提交可能包含工作目录内容的原始报告。

## 固定实验条件

```text
provider=local
model=glm-4.7-flash:latest
context_window=32768
MAX_OBSERVATION_CHARS=1200
REQUEST_TIMEOUT_SECONDS=300
compaction_trigger_tokens=800
keep_recent=2
summary_max_chars=1600
```

本地 Ollama 必须绕过系统 Lantern 代理：

```bash
export NO_PROXY=127.0.0.1,localhost
export no_proxy=127.0.0.1,localhost
```

初期未绕过代理时，本地请求出现挂起式等待；修复代理绕行后才完成正式实验。该问题属于实验环境故障，不归因于压缩实现。

## 三策略总体结果

| 策略 | 通过 | 成功率 | 平均步数 | 耗时 | 主模型 Token（输入/输出） | 摘要 Token（输入/输出） | 总模型 Token | 压缩次数 | 回退次数 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `off` | 4/6 | 66.67% | 5.67 | 58.27s | 65,667 / 2,420 | 0 / 0 | 68,087 | 0 | 0 |
| `extractive` | 3/6 | 50.00% | 4.67 | 59.51s | 37,706 / 2,634 | 0 / 0 | 40,340 | 16 | 0 |
| `model` | 3/6 | 50.00% | 6.33 | 1,310.95s | 55,313 / 3,167 | 28,273 / 48,093 | 134,846 | 26 | 12 |

峰值上下文：

| 策略 | 平均峰值上下文字符 | 平均峰值 prompt Token |
|---|---:|---:|
| `off` | 6,861.67 | 2,512.67 |
| `extractive` | 3,111.83 | 1,618.50 |
| `model` | 3,386.67 | 1,687.50 |

### 如何解读

相对 `off`，`extractive`：

- 总模型 Token 从 68,087 降到 40,340，下降 40.75%；
- 平均峰值上下文字符下降 54.65%；
- 平均峰值 prompt Token 下降 35.59%；
- 成功率从 66.67% 降到 50.00%，下降 16.67 个百分点。

`model` 与 `extractive` 的成功率相同，但总模型 Token 约为 `extractive` 的 3.34 倍，总耗时约为 22 倍。模型摘要自身产生了 28,273 输入 Token 和 48,093 输出 Token；其中 12 次因为超限、空输出、异常或证据缺失回退到确定性摘要。

这些数字只表示**成本下降与正确性下降同时出现**。不能据此宣称压缩提升正确性，也不能据此断言压缩必然伤害正确性。

## 分组结果

| Group | 任务数 | `off` | `extractive` | `model` |
|---|---:|---:|---:|---:|
| `retention` | 1 | 1/1 | 1/1 | 1/1 |
| `failure` | 1 | 1/1 | 0/1 | 0/1 |
| `todo` | 1 | 0/1 | 1/1 | 1/1 |
| `multi_file` | 1 | 1/1 | 1/1 | 1/1 |
| `rolling` | 2 | 1/2 | 0/2 | 0/2 |

`failure` 组需要单独解释：`model` 的最终回答保留了错误原文和恢复值，唯一失败检查是 `compaction_count_at_least:1`。该任务在第 2 次模型调用后结束，没有下一次模型请求可供压缩，属于任务契约设计缺陷，不是“模型摘要失败”。

## 成功与失败样本

### 成功保留

- `m1_2_value_retention`：三种策略都最终报告 `M12-VALUE-7319`。`extractive` 压缩 4 次，仍能保留分页后的精确值。
- `m1_2_multi_file_evidence`：三种策略都输出 `M12-ALPHA-M12-BETA-M12-GAMMA`，说明多文件来源在部分短路径上可被保留。
- `m1_2_todo_fixme`：`off` 只读到 44/85 行就声称没有 TODO；`extractive` 和 `model` 都报告了原文、行号和 `M12-TODO-1187`。这是本轮少见的压缩正向样本，但只有一个任务。

### 明确失真

- `m1_2_near_window_accumulation`：`off` 正确输出 `K7Q-A19|P2V-D47`。首次 `extractive` 在正确首值之后生成了大量不存在的 checkpoint；`model` 重复 `K7Q-A19` 并夹带不存在的 `E6R-R11`。
- `m1_2_repeated_compaction`：`off` 只读取 8/10 页，最终为空；首次 `extractive` 只读取 1 页且没有触发压缩；重跑读取 15 步后输出 `C8L-R93>G6K-Q31`，两个真实值顺序相反；`model` 运行 15 步达到上限。
- `m1_2_failure_recovery`：`off` 正确；`extractive` 达到最大步数并丢失两个必需值；`model` 内容正确但因没有发生压缩而失败对应检查。

当前实现会按证据优先级排序摘要条目。`repeated_compaction` 的顺序反转提示这一策略可能破坏时间顺序，但本轮没有做只改变排序规则的隔离实验，因此只记为**待验证根因假设**，不把它写成已证明结论。

## `extractive` 关键组重复运行

对 `rolling` group 的两个任务再运行一次：

| 指标 | 结果 |
|---|---:|
| 通过 | 0/2 |
| 平均步数 | 11.00 |
| 耗时 | 38.93s |
| 总模型 Token | 33,103 |
| 压缩次数 | 18 |
| 回退次数 | 0 |
| 平均峰值上下文字符 | 3,282.00 |
| 平均峰值 prompt Token | 1,591.00 |

- `m1_2_near_window_accumulation`：7 步，最终从 `P2V-D47` 开始，随后重复多个真实或不存在的 checkpoint；
- `m1_2_repeated_compaction`：15 步，最终值集合正确但顺序反转。

重跑确认了 `extractive` 的确定性和低成本没有自动转化为正确性。尤其需要验证摘要的时间顺序、证据边界和“哪些值属于当前任务”的约束。

## 复现命令

先准备环境：

```bash
cd /Users/wly/mini-claudecode
export NO_PROXY=127.0.0.1,localhost
export no_proxy=127.0.0.1,localhost
export REQUEST_TIMEOUT_SECONDS=300
export MAX_OBSERVATION_CHARS=1200
```

三个策略使用同一模型、任务集和预算，仅改变压缩策略：

```bash
# 对照组
python3 scripts/run_eval.py \
  --tasks evals/m1_2_tasks.json \
  --provider local \
  --model glm-4.7-flash:latest \
  --context-window-tokens 32768 \
  --compaction-strategy off \
  --compaction-keep-recent-messages 2 \
  --compaction-max-summary-chars 1600 \
  --output evals/results/m1_2-off-manual.json

# 确定性摘要
python3 scripts/run_eval.py \
  --tasks evals/m1_2_tasks.json \
  --provider local \
  --model glm-4.7-flash:latest \
  --context-window-tokens 32768 \
  --compaction-strategy extractive \
  --compaction-trigger-tokens 800 \
  --compaction-keep-recent-messages 2 \
  --compaction-max-summary-chars 1600 \
  --output evals/results/m1_2-extractive-manual.json

# 模型摘要
python3 scripts/run_eval.py \
  --tasks evals/m1_2_tasks.json \
  --provider local \
  --model glm-4.7-flash:latest \
  --context-window-tokens 32768 \
  --compaction-strategy model \
  --compaction-trigger-tokens 800 \
  --compaction-keep-recent-messages 2 \
  --compaction-max-summary-chars 1600 \
  --output evals/results/m1_2-model-manual.json
```

关键组重跑：

```bash
python3 scripts/run_eval.py \
  --tasks evals/m1_2_tasks.json \
  --ids m1_2_near_window_accumulation,m1_2_repeated_compaction \
  --provider local \
  --model glm-4.7-flash:latest \
  --context-window-tokens 32768 \
  --compaction-strategy extractive \
  --compaction-trigger-tokens 800 \
  --compaction-keep-recent-messages 2 \
  --compaction-max-summary-chars 1600 \
  --output evals/results/m1_2-extractive-repeat-manual.json
```

运行器在存在失败任务时返回非零退出码；只要报告已生成，就应保留失败结果，不要为提高通过数删除任务或覆盖记录。

## 实验限制

1. **样本很小**：每个策略只完整运行一次，每组 1–2 个任务；关键组只重复一次。不能估计稳定成功率、置信区间或显著性。
2. **只有单模型**：结论只对 `glm-4.7-flash:latest` 在当前 Ollama 服务上的这一批运行负责，不能外推到云端模型或其他本地模型。
3. **低阈值是人为压力条件**：800 Token 和只保留 2 条最近消息会放大多数十次压缩，不代表合理默认配置。
4. **成功检查是字符串级**：`output_contains` 和 `output_equals_normalized` 能发现缺失、重复和顺序错误，但不能全面判断语义忠实度。
5. **“失败样本”不等于单一因果**：模型随机性、任务工具契约、最大步数和压缩策略共同影响结果；当前没有逐步反事实重放。
6. **模型摘要成本与主模型共享同一 Provider**：报告区分了主模型和摘要 usage，但同一模型的服务负载和排队仍会影响耗时。
7. **云端探针失败**：`deepseek-chat` 探针返回 `402 Insufficient Balance`，因此正式对照改在本地模型运行；不能把云端 402 当作压缩实验失败，也不能跨 Provider 比较速度。
8. **原始报告不提交**：完整报告保存在本机且被 `.gitignore` 忽略，分享前必须检查并脱敏工具 observation。

## 已成立的结论

- 只用真实 `prompt_tokens` 触发、缺失 usage 不估算的路径有确定性测试覆盖；
- 三种策略在固定任务上都实际运行过；
- 压缩能降低本轮的平均上下文和主模型输入 Token；
- 压缩后的消息通过协议测试，模型摘要失败会回退到 `extractive`；
- 原始 Trace 保留压缩前的工具 observation；
- 确定性和模型压缩都出现了关键证据失真，默认关闭仍是现阶段最诚实的配置。

## 尚未成立的结论

- “历史压缩提高 Agent 任务成功率”；
- “`extractive` 比 `off` 更可靠”；
- “`model` 摘要值得额外成本”；
- “压缩策略在重复运行中稳定”；
- “这些结果可以推广到其他模型或生产任务”。

下一轮如果要继续 M1 压缩研究，应优先隔离证据排序、时间顺序和重复压缩边界，使用多次重复与置信区间，而不是只增加更多摘要策略。否则可以进入 M2 的 patch、测试和修复闭环，把本轮负面结果作为后续验证能力的需求来源。

## 对应 SDD 文档

- [Spec](specs/m1.2-history-compaction/spec.md)
- [Plan](specs/m1.2-history-compaction/plan.md)
- [Tasks](specs/m1.2-history-compaction/tasks.md)
- [Implement](specs/m1.2-history-compaction/implement.md)
- [ADR-003](decisions/ADR-003-history-compaction.md)
