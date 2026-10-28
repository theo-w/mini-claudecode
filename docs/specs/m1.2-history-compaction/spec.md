# m1.2 History Compaction Specification

- Spec ID：`m1.2-history-compaction`
- 状态：Verified
- 日期：2026-10-28
- 里程碑：M1 上下文管理
- 关联 ADR：ADR-003 History Compaction
- 关联 Baseline：[M1_CONTEXT_BASELINE.md](../../M1_CONTEXT_BASELINE.md)、[M1_2_COMPACTION_BASELINE.md](../../M1_2_COMPACTION_BASELINE.md)

## 1. 背景与问题

M1.1 已经让每轮上下文和 Token 可观测，并证明分页读取的 observation 会持续留在消息历史中，使后续 prompt 反复携带旧内容。当前 Harness 仍没有历史压缩：

- 工具 observation 一旦进入 `messages`，在本次运行结束前不会移除或压缩；
- 长文件逐页扫描和多文件任务会让输入 Token 随轮次持续增长；
- 没有区分“可以丢弃的噪声”和“必须保留的证据”；
- 没有验证模型生成摘要时是否会篡改文件名、行号、错误、TODO 或关键值；
- 没有模型摘要失败时的确定性回退；
- 没有测试压缩后的 `tool_call_id` 配对是否仍然合法。

M1.2 的学习问题不是“是否存在一个压缩函数”，而是：**在接近上下文窗口时，压缩能否以可控的信息损失维持任务成功，并且保留可追溯证据？**

## 2. 目标

建立一个最小、可对照的历史压缩机制：

1. 只在 Provider 返回真实 prompt Token 且达到配置阈值时自动触发；
2. 支持 `off`、`extractive` 和 `model` 三种策略；
3. 压缩较早历史，同时保留 system 指令、最新用户任务和最近消息窗口；
4. 确定性摘要保留工具名、参数中的路径、可提取行号、错误、TODO/FIXME 和当前任务的关键标识；
5. 模型摘要不调用工具，记录独立 usage；失败、空输出或协议异常时回退到确定性摘要；
6. 压缩后必须保持 assistant `tool_calls` 与 tool message 的合法配对；
7. 用同一组固定任务比较三种策略的成功率、步数、Token、上下文峰值和摘要调用成本；
8. 记录近上下文上限、错误证据和重复压缩的失真边界。

## 3. 用户故事或实验场景

- 作为学习者，我希望看到一次压缩前后的消息数、字符数、触发 Token 和摘要成本，而不是只知道“做了压缩”。
- 给定逐页扫描长文件的任务，当上下文超过阈值时，较早页面的关键证据应进入摘要，模型仍能报告正确值。
- 给定一个失败工具调用，压缩后仍应保留失败文件、错误原因和后续恢复事实。
- 给定多个 TODO 或错误记录，压缩后应保留原文和来源，而不是让模型重新猜测。
- 给定模型摘要服务失败或返回空内容，Harness 应继续运行并使用确定性摘要。
- 给定同一任务重复执行，我可以比较 `off`、`extractive`、`model` 的成功率和成本，而不是只看一次最好结果。

## 4. 范围

- 新增历史压缩模块与三种策略；
- 新增触发阈值、保留窗口和摘要字符上限配置；
- 在 Agent Loop 下一轮模型调用前执行压缩；
- 为确定性摘要增加证据提取和去重；
- 为模型摘要增加无工具摘要调用、usage 记录和失败回退；
- 压缩 Trace、Eval 指标和 group 汇总；
- 增加固定 M1.2 任务、确定性测试和 Live Eval；
- 新增 ADR，记录滚动摘要、默认关闭和证据优先的取舍。

## 5. 非目标

- 精确 Tokenizer 或基于字符伪造 Token；
- 在 Provider 报错后自动扩大上下文窗口；
- 跨进程持久化会话记忆或向量数据库；
- 对摘要进行语义忠实度的通用自动判定；
- 保证任意模型、任意任务下的压缩成功率；
- 使用摘要替代原始 Trace。压缩只影响下一次模型请求，不删除 Trace 中的原始 observation；
- 完成 M1 以外的验证闭环、失败重试或 Sandbox。

## 6. 功能需求

| ID | 需求 | 优先级 | 证据类型 |
|---|---|---|---|
| FR-001 | 仅当策略启用且上一次主模型请求的真实 `prompt_tokens >= COMPACTION_TRIGGER_TOKENS` 时触发压缩；缺失 usage 时不得估算触发。 | Must | 配置测试 / Trace |
| FR-002 | 压缩较早历史，保留 system 消息、最新 user 消息和至少 `COMPACTION_KEEP_RECENT_MESSAGES` 条最近消息。 | Must | 单元测试 |
| FR-003 | `extractive` 必须保留工具名、参数中的来源路径、可提取行号、错误、TODO/FIXME、当前任务关键标识，并对重复证据去重。 | Must | 单元测试 |
| FR-004 | `model` 摘要调用不得提供工具；必须记录独立请求、响应、usage 和耗时。空输出、异常或工具调用响应必须回退。 | Must | 单元测试 / Trace |
| FR-005 | 每次压缩记录策略、触发 Token、压缩前后字符/消息数、摘要字符数、回退原因和摘要 usage。 | Must | Trace / Eval |
| FR-006 | 压缩后的消息中，每个 tool message 必须有匹配的 assistant `tool_calls`，每个保留的 tool call 必须有响应。 | Must | 协议测试 |
| FR-007 | Eval 必须用同一任务集比较 `off`、`extractive`、`model`，并汇总成功率、步数、主/摘要 Token、上下文峰值和压缩次数。 | Must | 报告 JSON / 单元测试 |
| FR-008 | 增加覆盖关键值、错误、TODO、近上下文上限和重复压缩的固定 M1.2 任务。 | Must | 任务契约测试 / Live Eval |
| FR-009 | 原始 Trace 保留压缩前 observation；不得用摘要覆盖审计证据。 | Must | 代码审阅 / Trace 测试 |
| FR-010 | README、Roadmap、ADR、Baseline 和 Implement 必须准确区分确定性结果、单次 Live Eval 和未证明结论。 | Must | 文档检查 |

## 7. 非功能需求

| ID | 需求 | 约束 | 证据类型 |
|---|---|---|---|
| NFR-001 | 可复现性 | 模型、任务、阈值、窗口、observation 预算、命令和日期必须记录 | 文档 / Eval JSON |
| NFR-002 | 诚实度量 | 不把字符数当 Token；摘要调用 Token 不得漏算 | 测试 / 报告 |
| NFR-003 | 有界性 | 摘要字符数不得超过配置上限；压缩不得增加消息数 | 单元测试 |
| NFR-004 | 确定性 | 同一输入和配置下，`extractive` 输出稳定；重复压缩不应重复堆积相同证据 | 单元测试 |
| NFR-005 | 可恢复性 | 模型摘要失败不得终止主 Agent Loop | 单元测试 |
| NFR-006 | 协议兼容 | 不改变 Provider 工具 Schema；压缩后消息仍可被 OpenAI 兼容接口接受 | 协议测试 |
| NFR-007 | 安全边界 | 本次不新增文件、网络或执行能力；摘要调用不提供工具 | 代码审阅 / 测试 |

## 8. 验收标准

| ID | 验收标准 | 对应需求 | 验证方式 |
|---|---|---|---|
| AC-001 | 阈值以下不压缩；达到阈值且 usage 可用时压缩；usage 缺失时不压缩且记录原因。 | FR-001、FR-005 | `test_loop_records_below_threshold_without_compacting`、`test_loop_compacts_at_threshold_and_keeps_original_trace`、`test_loop_does_not_compact_without_usage` |
| AC-002 | 压缩保留 system、最新 user 和最近窗口，旧噪声被替换为一条有大小上限的摘要。 | FR-002、NFR-003 | `test_compaction_preserves_anchors_and_bounds_summary` |
| AC-003 | 确定性摘要保留来源路径、行号、错误、TODO 和任务关键值。 | FR-003 | `test_extractive_summary_preserves_evidence` |
| AC-004 | 模型摘要异常、空内容或返回工具调用时，回退到 extractive 且主循环继续。 | FR-004、NFR-005 | `test_model_summary_fallback_on_error`、`test_model_summary_fallback_on_empty_or_tool_response`、`test_model_summary_fallback_on_over_budget`、`test_model_summary_fallback_on_missing_evidence` |
| AC-005 | 压缩 Trace 含前后指标、策略、触发 Token、回退和摘要 usage。 | FR-005、NFR-002 | `test_loop_compacts_at_threshold_and_keeps_original_trace`、`test_model_summary_records_usage`、`test_context_metrics_count_compaction_usage` |
| AC-006 | 压缩后所有 tool_call/tool message 一一配对。 | FR-006、NFR-006 | `test_compaction_preserves_tool_protocol` |
| AC-007 | Eval 能分别运行三种策略并汇总压缩与摘要成本指标。 | FR-007 | `test_context_metrics_count_compaction_usage`、`test_aggregate_records_includes_compaction_costs` / Live Eval |
| AC-008 | M1.2 固定任务契约覆盖关键值、错误、TODO、近窗口和重复压缩。 | FR-008 | `test_m1_2_task_contract` / Live Eval |
| AC-009 | 原始 Trace 仍包含压缩前完整 observation。 | FR-009 | `test_loop_compacts_at_threshold_and_keeps_original_trace` |
| AC-010 | 所有确定性测试、compileall 和 diff check 通过，文档与实际结果一致。 | FR-010、NFR-001～NFR-007 | 最终验证命令 / Implement |

## 9. 指标

- 任务成功率与失败检查项；
- 平均步数和最大步数；
- 主模型输入、输出和总 Token；
- 摘要模型调用数、输入、输出和总 Token；
- 总模型调用成本（主模型 + 摘要模型）；
- 峰值上下文字符和峰值 prompt Token；
- 压缩次数、压缩前后字符差和摘要字符数；
- 回退次数与失败原因；
- 关键证据保留检查结果；
- 总耗时和工具错误数。

## 10. 安全与边界

- 压缩只改变下一次模型请求的消息副本，不删除 JSONL Trace；
- 模型摘要调用不提供任何工具，也不读取额外文件；
- 摘要 Prompt 和输出可能包含工具 observation，分享前仍需脱敏；
- `run_shell` / `run_python` 的宿主访问边界不变，本次不提供 Sandbox；
- 默认策略为 `off`，避免未经实验改变现有行为；
- 近窗口实验只在临时工作目录和受限 observation 预算中运行。

## 11. 风险与未决问题

- 风险：模型摘要可能遗漏或篡改关键事实。
  缓解：显式证据提取、摘要后协议测试、模型失败回退，以及 Live Eval 的确切值检查。
- 风险：滚动摘要可能发生二次失真。
  缓解：确定性策略对证据去重；模型策略记录每次压缩，并用重复压缩任务测试。
- 风险：摘要调用增加 Token 和延迟，可能抵消压缩收益。
  缓解：分别统计主模型与摘要模型 Token，不只看上下文峰值。
- 风险：真实 prompt Token 只在响应后可见，极端跨轮增长仍可能先撞窗口。
  缓解：默认阈值低于窗口，并在限制中明确；本次不实现响应前精确 Tokenizer。
- 风险：同一任务组样本少，不能推导稳定胜率。
  缓解：区分单次快照与重复运行，不报告未测得的显著性。

## 12. 完成条件

- [x] 所有 Must AC 有证据；
- [x] 确定性测试、静态检查和 M1.2 Live Eval 已运行；
- [x] 原始 Trace、失败样例和摘要成本被保留；
- [x] ADR、README、Roadmap、Baseline、Spec/Plan/Tasks/Implement 状态一致；
- [x] 未实现项进入后续规格，不混入 M1.2 完成声明。

验证说明：本规格验证的是压缩机制、观测和实验闭环。Live Eval 未证明压缩提升成功率，因此默认策略保持 `off`。
