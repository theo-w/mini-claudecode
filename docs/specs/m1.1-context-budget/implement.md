# m1.1 Context Budget Implementation Record

- Spec：[spec.md](spec.md)
- Plan：[plan.md](plan.md)
- Tasks：[tasks.md](tasks.md)
- 状态：Verified
- 实施日期：2026-10-28
- Baseline：[M1_CONTEXT_BASELINE.md](../../M1_CONTEXT_BASELINE.md)

## 1. 实际交付

M1.1 已把 Agent 的上下文使用从“只能看最终回答”推进到“每轮可观测、长文件可续读、实验可分组比较”：

- Provider 提取 prompt、completion 和 total tokens，缺失时返回 `None`；
- Agent Loop 每轮记录 Context Snapshot、usage 和窗口占比；
- `CONTEXT_WINDOW_TOKENS` 可配置并校验；
- Tool Registry 的截断有原始/返回字符数标记且不突破预算；
- `read_file` 在预算内按行分页并返回续读元数据；
- Eval 支持重复行 fixture、Token/上下文摘要和 group 汇总；
- 增加 5 个 M1 任务，覆盖长文件扫描、grep-first 和多文件累积；
- 完成一次 M1 Live Eval 和一次原 10 任务回归。

本轮没有实现自动历史摘要或裁剪，因此只完成 M1.1，不代表整个 M1 已完成。

## 2. 变更文件

| 文件 | 实际变更 |
|---|---|
| `agent/models.py` | 增加 `TokenUsage`，并挂到 `AssistantTurn` |
| `agent/context.py` | 增加确定性的消息与工具 observation 快照 |
| `agent/loop.py` | 每轮记录 `model_request`、usage 和窗口占比 |
| `agent/config.py` | 增加 `CONTEXT_WINDOW_TOKENS` 与 observation 预算校验 |
| `providers/openai_compat.py` | 提取真实 usage，缺失时不估算 |
| `tools/spec.py` | 改为有界、可诊断的 observation 截断 |
| `tools/builtin.py` | 增加 `read_file` 行分页和续读元数据 |
| `main.py` | 显示上下文窗口、observation 预算和每轮 Token 状态 |
| `scripts/run_eval.py` | 增加重复行 fixture、上下文指标、group 汇总和窗口接线 |
| `evals/m1_tasks.json` | 增加 5 个 M1 固定任务 |
| `tests/test_context_budget.py` | 增加 usage、Context Snapshot、分页、截断、指标和任务契约测试 |
| `.env.example` | 增加 `CONTEXT_WINDOW_TOKENS` 示例 |
| `README.md`、`docs/ROADMAP.md`、`docs/specs/README.md` | 同步当前能力和 M1 进度 |
| `docs/M1_CONTEXT_BASELINE.md` | 记录实验条件、指标、解释和限制 |

## 3. 验收证据

| AC | 证据 | 结果 |
|---|---|---|
| AC-001 | `test_extract_usage_reads_prompt_completion_and_total_tokens`、`test_extract_usage_derives_total_when_provider_omits_it`、`test_extract_usage_returns_none_when_provider_omits_it` | Pass |
| AC-002 | `test_loop_records_context_and_usage_each_turn` | Pass |
| AC-003 | `test_context_window_config_is_validated` | Pass |
| AC-004 | `test_read_file_paginates_with_continuation_metadata`、`test_read_file_rejects_single_line_over_budget` | Pass |
| AC-005 | `test_observation_is_bounded_and_has_metadata` | Pass |
| AC-006 | `test_write_setup_expands_repeated_lines`、`test_m1_task_contract` | Pass |
| AC-007 | `evals/results/m1-20261028-091040.json` 和 [M1_CONTEXT_BASELINE.md](../../M1_CONTEXT_BASELINE.md) | Pass |
| AC-008 | 28/28 确定性测试、compileall、`git diff --check` | Pass |

## 4. 验证命令与结果

### 4.1 确定性测试

```bash
python3 -m unittest discover -s tests -v
```

结果：

```text
Ran 28 tests in 0.063s
OK
```

### 4.2 静态检查

```bash
python3 -m compileall -q agent providers tools scripts tests main.py
git diff --check
```

结果：两项均通过。

### 4.3 M1 Live Eval

```bash
python3 scripts/run_eval.py \
  --tasks evals/m1_tasks.json \
  --provider cloud \
  --model deepseek-chat \
  --output evals/results/m1-<timestamp>.json
```

结果：5/5 通过，平均 4.00 步，18.04 秒；总输入 47,779 tokens，总输出 1,559 tokens。

`scan` 平均峰值上下文 16,224.5 chars / 5,521 prompt tokens；`grep_first` 为 1,703.0 chars / 1,300.5 prompt tokens。样本很小，只作为探索性对照。

### 4.4 原基线回归

```bash
python3 scripts/run_eval.py \
  --provider local \
  --model glm-4.7-flash:latest \
  --output evals/results/m1-regression-local-<timestamp>.json
```

结果：10/10 通过，平均 2.40 步，158.44 秒；总输入 21,787 tokens，总输出 1,539 tokens。云端 `deepseek-chat` 的回归尝试在完成 7 个任务后遇到 `402 Insufficient Balance`，因此该部分中止记录不纳入通过证据。

## 5. 计划与实际偏差

1. **Eval 的上下文窗口接线在 Live Eval 前修正**
   首次实现中，报告读取了 `CONTEXT_WINDOW_TOKENS`，但 `AgentLoop` 仍使用默认值。添加接线后，报告与 Trace 才使用同一预算。

2. **M1 长文件任务增加工具顺序契约**
   `scan` 任务要求至少两次 `read_file` 且不得调用 `grep`；`grep_first` 要求 `grep` 与 `read_file` 都成功，并新增 `tool_called_before` 检查，确保 `grep` 的调用顺序早于 `read_file`。这让分组意图可以被自动验证，而不再只看最终答案或“两个工具都调用过”。

3. **版本号提升为 v0.3.0**
   本轮增加新的可观测字段、配置和工具 observation 协议，属于兼容能力升级，因此在 CLI 中提升版本号；原始 10 个任务仍全部通过。

4. **M1 被拆成 M1.1 和 M1.2**
   为保持单一变更规格，本轮只交付预算观测、分页和实验入口。历史压缩与摘要失真留给 M1.2，不在本轮宣称完成。

5. **M1 与回归使用不同 Provider**
   M1 任务使用云端 `deepseek-chat`，原任务回归最终使用本地 `glm-4.7-flash:latest`。数字只用于各自条件下的回归检查，不进行跨 Provider 的性能比较。

## 6. 已知限制

- 没有自动摘要、历史裁剪或上下文窗口耗尽前的主动保护；
- 字符数不是 Token 数，不存在本地 Tokenizer；
- `read_file` 按行分页，超长单行无法在行内续读；
- Eval 会把完整事件和工具内容写入本地 JSON，分享前必须检查敏感信息；
- group 每组只有 1 到 2 个样本，不能估计稳定成功率；
- 只运行了一个云端模型和一次完整 M1 任务；
- scan 与 grep-first 不是严格的同文件、同模型重复随机对照；
- 结果文件被 `.gitignore` 忽略，仓库只保留可审阅的汇总记录。

## 7. 失败与负面结果

- 本轮没有观察到上下文过载导致的 M1 任务失败，因此没有真实失败样本可用于选择压缩策略；
- `scan` 虽然任务成功，但分页 observation 留在历史中，上下文仍会随着轮次持续增长；
- grep-first 的成本优势来自两个样例，不能外推为所有模型和文件规模的稳定结论；
- 原有的“完整读取 / 分段读取 / 摘要压缩”三组对照尚未全部建立，摘要组明确延期。

## 8. 后续工作

- 新开 `m1.2-history-compaction`：定义触发条件、压缩对象、证据保留和失败回退；
- 建立确定性压缩与模型摘要的对照任务；
- 在同一模型、同一任务上重复运行，记录成功率分布而非单次最好结果；
- 设计接近上下文上限的任务，观察性能衰减和信息遗漏；
- M1.2 验证后再进入 M2 的 `apply_patch` 与测试验证闭环。

## 9. 完成声明

- [x] 实现与 M1.1 规格一致，偏差已记录
- [x] 所有 Must AC 有证据
- [x] 28 个确定性测试、compileall 和 diff check 通过
- [x] M1 Live Eval 与原始任务回归完成
- [x] 安全边界和能力表述准确
- [x] README、Roadmap、规格索引和 Baseline 同步
- [x] 未完成的历史压缩进入 M1.2，而不是混入本轮声明

