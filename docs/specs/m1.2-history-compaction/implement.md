# m1.2 History Compaction Implementation Record

- Spec：[spec.md](spec.md)
- Plan：[plan.md](plan.md)
- Tasks：[tasks.md](tasks.md)
- 状态：Verified
- 实施日期：2026-10-28
- Baseline：[M1_2_COMPACTION_BASELINE.md](../../M1_2_COMPACTION_BASELINE.md)
- ADR：[ADR-003](../../decisions/ADR-003-history-compaction.md)

## 1. 实际交付

M1.2 已建立一个可运行、可观测、可回退的历史压缩机制：

- 支持 `off`、`extractive`、`model` 三种策略，默认保持 `off`；
- 只在上一轮 Provider 返回真实 `prompt_tokens >= COMPACTION_TRIGGER_TOKENS` 时触发，usage 缺失不估算；
- 保留 system、最新 user 和最近消息窗口，并在必要时扩展边界以维护 tool-call 配对；
- `extractive` 提取工具名、来源路径、行号、错误、TODO/FIXME、分页元数据和任务关键标识，并去重、限制摘要大小；
- `model` 使用无工具摘要请求；异常、空输出、工具调用响应、超限和缺失必需证据时回退到 `extractive`；
- 压缩只改变下一次模型请求使用的消息，不删除原始 Trace observation；
- Trace 和 Eval 记录主模型与摘要模型 usage、压缩次数、回退、压缩前后字符及峰值上下文；
- 新增 6 个 M1.2 任务、三策略 Live Eval 和关键组重复运行。

本记录不宣称压缩提升了成功率。实际实验结论是：机制完成了，但收益假设未成立，且暴露了证据时序失真。

## 2. 变更文件

| 文件 | 实际变更 |
|---|---|
| `agent/compaction.py` | 新增边界选择、协议校验、证据提取、模型摘要、回退和摘要格式 |
| `agent/config.py` | 增加压缩策略、触发 Token、保留窗口和摘要上限配置与校验 |
| `agent/loop.py` | 在下一轮模型调用前读取上一轮 usage 并接入压缩 |
| `agent/context.py` | 增加压缩摘要标记、角色计数和摘要字符观测 |
| `providers/openai_compat.py` | 无工具摘要请求省略 `tools` / `tool_choice`，保持 OpenAI 兼容 |
| `tools/builtin.py` | 修正 `read_file` 的 `has_more`、`file_has_more` 和 `next_start_line` 语义 |
| `main.py` | 增加 CLI 压缩参数、事件输出和配置展示，版本提升为 v0.4.0 |
| `scripts/run_eval.py` | 增加策略参数、摘要 usage、压缩指标、group 汇总和任务检查 |
| `tests/test_history_compaction.py` | 增加 22 个压缩、协议、回退、Eval 和任务契约测试 |
| `tests/test_provider.py` | 增加 2 个无工具请求与工具请求协议测试 |
| `.env.example` | 增加 `COMPACTION_*` 配置示例，默认 `off` |
| `evals/m1_2_tasks.json` | 增加 6 个证据、错误、TODO、多文件、近窗口和重复压缩任务 |
| `docs/decisions/ADR-003-history-compaction.md` | 记录滚动摘要、默认关闭、证据优先和回退取舍 |
| `docs/M1_2_COMPACTION_BASELINE.md` | 固定实验条件、指标、失败样本和限制 |
| `README.md`、`docs/ROADMAP.md`、`docs/specs/README.md` | 同步 v0.4.0 能力、实验状态和下一步 |

## 3. 验收证据

| AC | 证据 | 结果 |
|---|---|---|
| AC-001 | `test_loop_compacts_at_threshold_and_keeps_original_trace`、`test_loop_records_below_threshold_without_compacting`、`test_loop_does_not_compact_without_usage` | Pass |
| AC-002 | `test_compaction_preserves_anchors_and_bounds_summary`、`test_does_not_replace_history_with_a_larger_summary` | Pass |
| AC-003 | `test_extractive_summary_preserves_evidence`、`test_repeated_compaction_deduplicates_evidence` | Pass |
| AC-004 | `test_model_summary_fallback_on_error`、`test_model_summary_fallback_on_empty_or_tool_response`、`test_model_summary_fallback_on_over_budget`、`test_model_summary_fallback_on_missing_evidence` | Pass |
| AC-005 | `test_loop_compacts_at_threshold_and_keeps_original_trace`、`test_context_metrics_count_compaction_usage`、`test_aggregate_records_includes_compaction_costs` | Pass |
| AC-006 | `test_compaction_preserves_tool_protocol`、`test_validate_tool_protocol_detects_orphans` | Pass |
| AC-007 | 三策略 Live Eval 报告和 [Baseline](../../M1_2_COMPACTION_BASELINE.md) | Pass；成功率为 `off` 66.67%、`extractive` 50%、`model` 50% |
| AC-008 | `test_m1_2_task_contract`、`test_evals_accept_whitespace_variants_and_require_all_paths`、`test_compaction_check_is_enforced_only_when_enabled`、6 任务 Live Eval | Pass；同时暴露 `failure_recovery` 缺少第三次调用的设计缺陷 |
| AC-009 | `test_loop_compacts_at_threshold_and_keeps_original_trace`、Live Eval 原始事件 | Pass |
| AC-010 | 54/54 单元测试、compileall、`git diff --check`、文档和 Baseline | Pass |

## 4. 验证命令与结果

### 4.1 确定性测试

```bash
python3 -m unittest discover -s tests -v
```

结果：

```text
Ran 54 tests
OK
```

新增测试覆盖触发边界、usage 缺失、摘要锚点、摘要预算、证据提取、重复去重、模型摘要成功与四类回退、tool-call 协议、Trace 原始 observation、Eval 成本汇总、任务契约和 Provider 无工具请求。

### 4.2 静态检查

```bash
python3 -m compileall -q main.py agent providers tools scripts tests
git diff --check
git status --short
git ls-files .env
```

结果：compileall 和 diff check 通过；`git ls-files .env` 无输出，`.env` 未被跟踪。

### 4.3 M1.2 Live Eval

统一条件：

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

| 策略 | 通过 | 成功率 | 平均步数 | 总耗时 | 总模型 Token | 压缩 | 回退 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `off` | 4/6 | 66.67% | 5.67 | 58.27s | 68,087 | 0 | 0 |
| `extractive` | 3/6 | 50.00% | 4.67 | 59.51s | 40,340 | 16 | 0 |
| `model` | 3/6 | 50.00% | 6.33 | 1,310.95s | 134,846 | 26 | 12 |

`extractive` 对 `rolling` 两个关键任务重复运行：0/2 通过，平均 11.00 步，33,103 总模型 Token，18 次压缩，0 次回退。

### 4.4 外部服务记录

正式实验使用本地 Ollama。初期本地请求经系统 Lantern 代理时出现挂起，设置 `NO_PROXY=127.0.0.1,localhost` 和 `no_proxy=127.0.0.1,localhost` 后恢复。之后尝试云端 `deepseek-chat` 探针时返回 `402 Insufficient Balance`，该探针不作为对照证据。

## 5. 计划与实际偏差

1. **修正 `read_file` 的续读语义**
   M1.2 任务要求读到 `file_has_more=false`。原实现把“本次请求区间是否到尾部”和“整个文件是否还有内容”混在 `has_more` / `next_start_line` 中，导致预算截断后可能缺少续读入口。本轮把 `has_more` 定义为本次请求区间未读完，`file_has_more` 定义为文件尾未到达，并用测试固定。

2. **Provider 无工具调用改为省略字段**
   模型摘要调用不提供工具。部分 OpenAI 兼容服务不接受 `tools=[]` 加 `tool_choice=auto`，因此 Provider 在工具列表为空时不发送这两个字段。

3. **正式评测从云端切换到本地**
   云端探针 402 余额不足；本地 `glm-4.7-flash:latest` 在三策略和一次关键组重复运行中均完成报告生成。切换 Provider 后只做同 Provider 内三策略比较。

4. **增加关键组重跑**
   Plan 只要求“如时间允许”。由于首次 `extractive` 已出现证据失真，实际补跑了 `rolling` group 一次，结果仍为 0/2，因此保留负面证据。

5. **`failure_recovery` 的压缩检查存在设计缺陷**
   期望触发一次压缩，但任务只需两次模型调用即可完成；压缩又只在“下一轮模型请求前”执行，所以第 2 步后没有第三次模型调用可供压缩。`model` 策略内容正确却只失败该检查。后续应增加一个强制形成第三次模型调用的检查，或把压缩检查移到天然多轮任务。本轮没有为了通过测试而修改任务期望。

6. **版本提升为 v0.4.0**
   新增配置、Trace 事件、压缩模块和 Eval 指标，属于兼容能力升级，因此 CLI 和 README 提升版本；默认行为仍与 v0.3.0 的 `off` 一致。

## 6. 已知限制

- 触发只能使用响应后的真实 usage，无法在请求发出前精确预测下一次 prompt 大小；
- 摘要字符上限不是 Tokenizer 预算，不能保证 Provider 的 tokenizer 下同样有界；
- `extractive` 只能保留规则能识别的信息，且当前按证据优先级排序，可能破坏时间顺序；
- `model` 摘要会引入额外 Token、延迟、非确定性和外部服务失败；
- `model` 的“必需证据”检查是字符串级，不能证明摘要语义完全忠实；
- 压缩摘要会进入下一次模型请求，仍应在分享 Trace 前脱敏；
- 测试任务的工具调用预算和最大步数仍可能改变模型行为，不能只归因于压缩；
- 本轮只有一个本地模型、每个策略一次完整运行，结论不具备统计外推能力；
- `run_shell` / `run_python` 没有因此获得 Sandbox 隔离，审批仍是 Harness 层边界。

## 7. 失败与负面结果

- `off`：`todo_fixme` 只读取前 44/85 行就声称没有 TODO；`repeated_compaction` 只读取 8/10 页并以空回答结束。
- `extractive`：`failure_recovery` 达到 max steps 且丢失错误原文和恢复值；`near_window_accumulation` 生成大量不存在的 checkpoint；`repeated_compaction` 首次只读 1 页、0 次压缩。
- `extractive` 重跑：`near_window_accumulation` 从末值开始并重复伪造值；`repeated_compaction` 输出正确值集合但顺序反转。
- `model`：`failure_recovery` 内容正确但 0 次压缩；`near_window_accumulation` 重复 `K7Q-A19` 并夹带不存在的 `E6R-R11`；`repeated_compaction` 15 步达到上限。
- `model` 的 26 次压缩中有 12 次回退，主要来自摘要超限、异常、空输出或缺失必需证据。
- 三策略成功率为 66.67% / 50% / 50%，没有证据支持“启用压缩提高成功率”。

## 8. 后续工作

- 如果继续压缩研究：新增独立规格，先隔离证据时序问题，再使用多次重复和置信区间；
- 修复候选：区分“选择进入摘要的证据优先级”和“摘要中的展示顺序”，保留原始工具调用顺序；
- 为 `near_window_accumulation` 和 `repeated_compaction` 增加多次随机重复，而不是扩大单任务长度；
- 任务契约应保证压缩检查所依赖的模型调用确实存在，避免短路径绕过；
- 默认继续使用 `off`，直到有足够的跨任务、重复运行证据；
- 如果暂停优化，进入 M2：`apply_patch`、修改后测试和验证修复闭环。

## 9. 完成声明

- [x] 实现与 M1.2 规格一致，偏差已记录
- [x] 所有 Must AC 有确定性或 Live Eval 证据
- [x] 54 个确定性测试、compileall 和 diff check 通过
- [x] 三策略 Live Eval 与关键组重复运行完成
- [x] 成功、失败、外部服务故障和设计缺陷均被保留
- [x] 安全边界描述准确，没有把审批或进程边界称为 Sandbox
- [x] 默认 `off`，压缩收益未被证明的结论写入 README、Roadmap 和 Baseline
