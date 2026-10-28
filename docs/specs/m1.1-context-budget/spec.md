# m1.1 Context Budget Specification

- Spec ID：`m1.1-context-budget`
- 状态：Verified
- 日期：2026-10-28
- 里程碑：M1 上下文管理
- 关联 ADR：无
- 关联 Baseline：[M1_CONTEXT_BASELINE.md](../../M1_CONTEXT_BASELINE.md)

## 1. 背景与问题

v0.2.1 已经能稳定执行短任务，但还无法回答“上下文何时开始失真或耗尽”：

- Provider 没有提取 Chat Completions 返回的 Token usage；
- Trace 只记录消息内容，没有每一轮请求的上下文字符数、工具 observation 占比和 Token 使用率；
- `read_file` 虽然支持行范围，但默认读取长文件时只会被整体截断，模型不知道下一段从哪里继续；
- 通用截断直接丢弃尾部内容，没有 `original_chars`、`returned_chars` 等可诊断信息；
- 固定评测任务都是短文件，无法观察长文件查找和多文件累积下的上下文行为。

如果不先补上这些观测与恢复机制，后续自动摘要和上下文压缩只能靠感觉判断是否有效。

## 2. 目标

建立一个可测量的 Context Budget 基线：

1. 每次模型请求都能记录上下文字符数、消息数、工具 observation 字符数；
2. Provider 返回 usage 时，记录每轮输入、输出和总 Token；
3. 长文件读取在 observation 预算内分页，并向模型提供明确的续读入口；
4. 截断行为有结构化元数据且绝不突破配置的字符预算；
5. 用固定 M1 任务比较“从头扫描”和“先用 grep 定位再读取”的行为差异；
6. 保留多文件累积任务，观察输入 Token 和上下文峰值如何增长。

## 3. 用户故事或实验场景

- 作为学习者，我希望看到每一轮模型请求到底带了多少上下文，而不是只知道最终用了多少步。
- 给定一个超过单次 observation 预算的日志文件，当模型读取第一页时，它能看到已返回行、剩余行和 `next_start_line`，从而继续读取。
- 给定同一个长文件，我可以比较逐页扫描与 grep-first 的成功率、步数、输入 Token 和上下文峰值。
- 给定需要综合多个文件的任务，我可以观察总输入 Token 与峰值上下文是否随文件数增长。
- 当 Provider 不返回 usage 时，报告必须显示 `null`，不能伪造估算 Token。

## 4. 范围

- 在 Provider 中提取 OpenAI 兼容 Chat Completions usage；
- 在 Agent Loop 中记录每轮上下文快照和 usage；
- 增加 `CONTEXT_WINDOW_TOKENS` 配置与使用率；
- 改进 Tool Registry 的截断标记和字符上限；
- 为 `read_file` 增加分页边界、续读行号和预算触发信息；
- 支持评测 fixture 的重复行生成，避免在 JSON 中复制大文件；
- 增加 M1 专用固定任务和分组指标；
- 增加确定性测试、M1 Live Eval 与实验记录。

## 5. 非目标

- 自动调用模型做历史摘要；
- 多轮会话历史压缩；
- 根据 Token usage 自动中止或裁剪历史；
- 精确 Tokenizer 或本地 Token 估算；
- 上下文窗口中途扩容、模型迁移或 Prompt Caching；
- 证明某个模型在不同上下文长度下具备稳定能力；
- 完成整个 M1。M1 后续仍需验证摘要压缩与失真边界。

## 6. 功能需求

| ID | 需求 | 优先级 | 证据类型 |
|---|---|---|---|
| FR-001 | Provider 必须提取 usage 中的 prompt、completion 和 total tokens；缺失时保留 `None`。 | Must | 单元测试 / Trace |
| FR-002 | 每次模型请求必须记录 context chars、message count、tool observation chars/count 与最大单条 observation 字符数。 | Must | 单元测试 / Trace |
| FR-003 | Harness 必须支持 `CONTEXT_WINDOW_TOKENS`，并在 usage 可用时记录 prompt Token 占窗口比例。 | Must | 配置测试 / Trace |
| FR-004 | `read_file` 必须在字符预算内返回可读分页，并报告 requested/returned range、`has_more`、`next_start_line`。 | Must | 单元测试 / Eval |
| FR-005 | 通用 observation 截断必须包含原始/返回字符数标记，且最终内容不超过 `MAX_OBSERVATION_CHARS`。 | Must | 单元测试 |
| FR-006 | 评测器必须支持重复行 fixture，并提供长文件扫描、grep-first 和多文件累积任务。 | Must | fixture 测试 / Eval Task |
| FR-007 | Eval 报告必须包含每任务 Token/上下文汇总、每轮明细和可选 group 汇总。 | Must | 报告 JSON / 单元测试 |
| FR-008 | README、Roadmap、M1 实验记录必须准确描述已实现能力和未完成项。 | Must | 文档检查 |

## 7. 非功能需求

| ID | 需求 | 约束 | 证据类型 |
|---|---|---|---|
| NFR-001 | 可复现性 | M1 任务、模型、预算、命令和日期必须记录 | 文档 / Eval JSON |
| NFR-002 | 诚实度量 | Provider 无 usage 时不得估算为真实 Token | 测试 / 报告 |
| NFR-003 | 预算边界 | 单条 tool observation 最终字符数不得超过配置上限 | 测试 |
| NFR-004 | 可恢复性 | 长文件分页必须提供足够的续读元数据 | 测试 / Live Eval |
| NFR-005 | 兼容性 | usage 字段缺失时现有 Agent Loop 和测试仍可运行 | 回归测试 |
| NFR-006 | 安全性 | 新增统计不得额外暴露环境变量、密钥或工作目录外文件 | 代码审阅 / 回归测试 |

## 8. 验收标准

| ID | 验收标准 | 对应需求 | 验证方式 |
|---|---|---|---|
| AC-001 | 给定带 usage 的模型响应，Provider 返回准确的 TokenUsage；无 usage 时返回 `None`。 | FR-001 | `test_extract_usage_*` |
| AC-002 | 给定两轮模型调用，Trace 中存在两轮 context snapshot 和 usage 记录。 | FR-002、FR-003 | `test_loop_records_context_and_usage` |
| AC-003 | `CONTEXT_WINDOW_TOKENS` 可配置，非法值被拒绝。 | FR-003 | `test_context_window_config*` |
| AC-004 | 读取超过预算的文件时返回第一页和 `next_start_line`；从该行继续可读到后续 marker。 | FR-004 | `test_read_file_paginates_with_continuation_metadata` |
| AC-005 | 任意 observation 被截断后长度不超过预算，并包含原始/返回字符信息。 | FR-005 | `test_observation_is_bounded_and_has_metadata` |
| AC-006 | M1 fixture 能生成稳定重复行，任务契约检查通过。 | FR-006 | `test_write_setup_expands_repeated_lines` / contract check |
| AC-007 | M1 Eval 报告包含 Token、上下文峰值、每轮明细和 group 汇总；至少完成一次真实模型运行并保留结果。 | FR-007、NFR-001 | `evals/results/m1-*.json` 本地文件 + 文档摘要 |
| AC-008 | 所有确定性测试、compileall 和 diff check 通过。 | NFR-001～NFR-005 | 验证命令 |

## 9. 指标

- 成功率：按固定 M1 任务自动检查；
- 平均步数；
- 每任务输入 / 输出 / 总 Token；
- 每轮 context chars；
- 峰值工具 observation chars；
- 峰值 prompt Token；
- 峰值上下文窗口使用率；
- 总耗时和工具错误数；
- `scan` 与 `grep_first` 分组的上述指标差异。

## 10. 安全与边界

- 本次不新增文件、网络或执行能力；
- 上下文统计只记录消息长度和 Provider usage，不读取新的宿主资源；
- `read_file` 仍受工作目录 Guardrail 约束；
- Trace 和 Eval JSON 仍可能包含工具 observation，分享前必须检查敏感信息；
- 本次能力是预算观测和 observation 分页，不是自动上下文压缩，也不是安全隔离。

## 11. 风险与未决问题

- 风险：不同 OpenAI 兼容服务返回的 usage 字段可能不一致或缺失。  
  缓解：缺失时保留 `None`，不伪造统计。
- 风险：字符数与 Token 数不是线性关系，不能替代真实 usage。  
  缓解：同时记录字符和 Provider Token。
- 风险：`read_file` 分页按字符预算切分，超长单行无法在行内继续。  
  缓解：明确返回错误或记录边界，并在限制中说明。
- 风险：每个 group 的样本量很小，只能作为探索性观察。  
  缓解：报告不作为稳定率或泛化结论。
- 待决：M1.2 是否采用模型摘要还是确定性 observation 压缩，需要基于本轮失败样本决定。

## 12. 完成条件

- [x] 所有 Must AC 有证据；
- [x] 确定性测试、静态检查和固定 Live Eval 已运行；
- [x] M1 实验记录说明真实 Token、字符、成功率和失败样本；
- [x] README、Roadmap、Spec/Plan/Tasks/Implement 状态一致；
- [x] 未实现的摘要压缩进入后续规格，不混入本轮完成声明。
