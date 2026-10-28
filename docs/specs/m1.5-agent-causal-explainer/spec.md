# m1.5 Agent Causal Explainer Specification

- Spec ID：`m1.5-agent-causal-explainer`
- 状态：Verified
- 日期：2026-10-28
- 验证日期：2026-10-28
- 里程碑：M1 上下文管理与可观测性
- 关联 ADR：ADR-004 Read-only Agent Anatomy（延续只读投影与无 Web 执行入口）
- 关联 Baseline：[M1_2_COMPACTION_BASELINE.md](../../M1_2_COMPACTION_BASELINE.md)

## 1. 背景与问题

M1.4 已把 Trace 组织成按 `step` 排列的任务故事，但仍存在四个理解断层：

1. 报告没有携带任务契约，页面无法回答“为什么要读这个文件”“为什么禁止 grep”；
2. 连续 5 次分页读取被当作 5 个平铺轮次，读者看不到 `next_start_line=22` 与下一次 `start_line=22` 的可观察关联；
3. checks 只显示勾叉，没有说明它防什么伪成功、失败说明什么、对应哪种 Agent 机制；
4. `compaction_count_at_least:...:skipped=off` 显示绿色通过，容易被误读为压缩成功。

这不是视觉密度问题，而是实验缺少“问题—契约—证据—结论”的教学结构。M1.5 把默认视图从 Trace 播放器提升为 Agent 机制解释器，但仍不声称展示模型内部思维链。

## 2. 目标

1. 导入任务契约的确定性摘要，让页面能解释实验目的、Prompt、fixture 规模和 checks 设计；
2. 将连续分页读取聚合为一个 episode，默认折叠重复轮次，并保留逐事件定位；
3. 只基于字段匹配建立强因果边，例如 `Observation.next_start_line === 下一次 tool_call.start_line`；
4. 按最终验收、过程约束、能力证据、实验完整性解释 checks，并区分 `PASS / FAIL / SKIP / UNKNOWN`；
5. 在页面末尾给出由本次 Trace 支持、可带走的 Agent 机制结论，同时标出不能从单次 A/B 推出的结论；
6. 保持离线、只读、无虚构运行和无在线调参。

## 3. 用户故事或实验场景

- 作为 Agent 初学者，我打开默认任务后，先看到“实验要验证什么、为什么 fixture 这么长、为什么禁止 grep”，再看到结果。
- 作为学习者，我希望看到上一条 Observation 中的哪个结构化字段出现在下一次调用参数里，而不是只看到“模型决定继续读取”。
- 作为学习者，我希望 checks 按目的分组，每项说明它防止哪种伪成功，以及它帮助理解 Agent 的哪一部分。
- 作为比较实验者，我希望 A/B 页面继续使用同一套 check 状态语义，且 `SKIP` 不会被画成 `PASS`。
- 作为维护者，我希望没有导入任务契约时页面明确降级，而不是用猜测补写 Prompt 或 fixture。
- 给定字段不匹配或数据缺失，页面不得生成强因果边，只显示“记录不足”或“未匹配”。

## 4. 范围

- 扩展本地导出器以导入一份或多份任务集，并只导出确定性契约摘要；
- 新增 fixture 行数推导、check 分类、check 分组、因果链、episode 聚合和实验总结纯函数；
- 重构默认任务故事首屏、因果链、轮次、checks 和 takeaways；
- 统一 Story、Replay、A/B 的 check 状态文字与形状语义；
- 增加确定性单元测试、真实本地数据导出和浏览器验收；
- 同步 README、Roadmap、规格索引和实施记录。

## 5. 非目标

- 不展示或推断模型内部思维链、隐藏推理或“真实动机”；
- 不改变 Agent Loop、Prompt、模型、工具 Schema、审批、压缩策略或 checks；
- 不新增 Live Eval，不把已有单次报告升级为统计或因果结论；
- 不导出完整 fixture 内容，不承诺导出文件已脱敏；
- 不在浏览器运行 Agent、执行工具、修改任务或提供可保存的在线参数调节；
- 不新增前端框架、构建链、CDN、后端、外部字体或 npm 运行时依赖；
- 不提供拖拽式 Agent 编排。

## 6. 功能需求

| ID | 需求 | 优先级 | 证据类型 |
|---|---|---|---|
| FR-001 | 导出器 `--tasks` 可重复传入任务集；同一 task ID 合并，内容冲突时报错；旧报告路径不被用于猜测任务文件。 | Must | 单元测试 / CLI |
| FR-002 | Dashboard 数据顶层包含可选 `task_contracts`；契约只含 id、group、tags、prompt、checks、max_steps 与 fixture 确定性摘要，不含 fixture 正文。 | Must | 单元测试 / JSON 检查 |
| FR-003 | fixture 摘要正确计算重复块行数，例如 `24 × 4 + 3 = 99`，并同时保留组成字段供页面解释。 | Must | 纯函数测试 |
| FR-004 | 默认任务故事先展示实验问题、任务约束、fixture 设计、成功标准和对应机制；缺少契约时明确提示“未导入任务契约”。 | Must | 浏览器 |
| FR-005 | 连续 pagination 读取聚合为 episode，默认折叠重复轮次；展开后可定位每个真实 `step` 和事件。 | Must | 纯函数测试 / 浏览器 |
| FR-006 | 因果链只展示 Trace 可观察字段；仅当 `has_more === true` 且 `next_start_line === 下一次 start_line` 时生成强关联 edge。 | Must | 纯函数测试 / 浏览器 |
| FR-007 | checks 分为最终验收、过程约束、能力证据、实验完整性四组；每项说明检查目的、防住的伪成功、失败含义、对应机制和原始判定。 | Must | 纯函数测试 / 浏览器 |
| FR-008 | check 状态必须用 `PASS / FAIL / SKIP / UNKNOWN` 文字和不同形状表达；含 `skipped=` 的检查不得显示为 PASS。 | Must | 纯函数测试 / Story、Replay、A/B |
| FR-009 | 页面显示由本次真实证据支持的学习结论，并明确单次 A/B 只能定位路径差异，不能证明策略因果。 | Must | 浏览器 |
| FR-010 | 保持既有 Story、Replay、Anatomy、A/B 功能；页面离线、只读、0 external request、无 runtime error。 | Must | 回归测试 / 浏览器 |
| FR-011 | 390px 宽度无横向溢出；因果链和 check 卡片在移动端改为单列。 | Must | 浏览器 |

## 7. 非功能需求

| ID | 需求 | 约束 | 证据类型 |
|---|---|---|---|
| NFR-001 | 可复现性 | 同一报告与任务集产生确定性 `task_contracts` 和因果链；最终数据仍由脚本生成。 | 测试 / 命令 |
| NFR-002 | 向后兼容 | `schema_version` 保持 `1`；无 `task_contracts` 的旧数据可正常加载并降级。 | 单元测试 / 浏览器 |
| NFR-003 | 证据边界 | 不使用“模型理解了”“模型决定继续”等内部动机表述；只写响应、参数和字段匹配。 | 文案检查 / 浏览器 |
| NFR-004 | 数据卫生 | 不导出 fixture 正文；导出的 Prompt 与 Trace 仍按 `local-unredacted` 保护，禁止提交 `dashboard/data.json`。 | 测试 / Git 检查 |
| NFR-005 | 可访问性 | 状态不只依赖颜色；折叠使用原生 `details`；文字与背景保持可读对比。 | 浏览器 / 静态结构 |

## 8. 验收标准

| ID | 验收标准 | 对应需求 | 验证方式 |
|---|---|---|---|
| AC-001 | 给定 M1.2 任务集，导出数据包含 6 个 task contract；默认 fixture 行数为 99，且不含 fixture 行正文。 | FR-001/002/003 | `test_load_task_contracts_summarizes_fixtures_without_content`、CLI 导出 |
| AC-002 | 给定重复 task ID 的相同内容可合并，不同内容则报冲突。 | FR-001 | `test_merge_task_contracts_rejects_conflicting_duplicates` |
| AC-003 | 给定无 `task_contracts` 的旧数据，页面显示“未导入任务契约”，其余视图正常。 | FR-004/NFR-002 | 浏览器 QA / 结构测试 |
| AC-004 | 默认任务首屏解释 99 行 fixture、禁止 grep 的约束和成功标准。 | FR-004 | Playwright |
| AC-005 | 连续 5 次分页读取聚合为 1 个 episode，默认折叠；展开显示 S1–S5 与真实范围。 | FR-005 | `test_collapses_continuous_pagination_into_one_episode`、Playwright |
| AC-006 | `next_start_line=22` 与下一次 `start_line=22` 形成强 edge；不相等或字段缺失时不形成强 edge。 | FR-006 | `test_builds_causal_edge_only_from_matching_fields` |
| AC-007 | 默认 checks 分为 4 组；compaction 检查显示 `SKIP / 策略关闭`，不是 PASS。 | FR-007/008 | `test_classifies_skipped_check_as_skip`、`test_groups_checks_by_learning_purpose`、Playwright |
| AC-008 | Story、Replay、A/B 的 check 状态均含文字；页面包含 5 条学习结论与单次 A/B 边界。 | FR-008/009 | 浏览器 / 结构测试 |
| AC-009 | 既有测试全部通过，Node/Python 静态检查与 `git diff --check` 通过。 | FR-010 | 完整质量门禁 |
| AC-010 | 桌面与 390px 四视图可操作，无横向溢出、0 runtime error、0 external request。 | FR-010/011 | Playwright |

## 9. 指标

- Dashboard 首屏解释覆盖率：默认任务必须解释 5 类机制（工具契约、Observation、Context 延续、停止条件、结果验收）；
- 分页压缩效果：默认任务由 6 个平铺轮次变为不超过 4 个 episode 摘要，同时保留 5 个真实调用；
- check 语义覆盖率：默认任务 5 个 checks 均映射到目的、伪成功、失败含义和机制；
- 技术回归：既定测试全绿，新增因果/分类测试全绿；
- 浏览器质量：4 视图 × 桌面/390px，横向溢出 0，runtime error 0，external request 0。

## 10. 安全与边界

- 本变更只读取已有 Eval JSON 与任务集，不运行模型或工具；
- `--tasks` 只导出 Prompt 与 fixture 摘要，不导出 fixture 正文；
- `dashboard/data.json` 仍是 `local-unredacted`，继续被 Git 忽略，禁止提交或公开；
- 页面没有写文件、执行命令、网络请求或参数提交入口；
- 因果边是字段一致性的可观察关联，不是模型内部动机或统计因果推断；
- 单次 A/B 差异不能证明压缩策略导致结果变化；
- 回滚只需恢复导出器、前端和测试文件；无数据迁移。

## 11. 风险与未决问题

- 风险：将字段一致写成“模型因为看到字段而继续”会越界。缓解：固定使用“Observation 给出该字段，下一次调用使用相同值；内部动机未记录”。
- 风险：check 文案可能与未来 check 类型脱节。缓解：未知类型归入“其他检查”并显示 UNKNOWN 语义，不猜作用。
- 风险：任务集与报告 task ID 不一致。缓解：页面按 ID 连接，缺失时显式降级；导出不根据路径猜测。
- 风险：聚合 episode 隐藏真实步骤。缓解：聚合卡默认折叠但可展开，每个 step 与事件定位仍保留。
- 待决：未来是否需要可视化跨文件证据时序；本轮只实现单任务可验证聚合。

## 12. 完成条件

- 所有 AC 有确定性或浏览器证据；
- 旧数据降级、未知 check 和字段不匹配均有测试；
- 不新增 Live Eval，并记录理由；
- README、Roadmap 与规格索引同步；
- `dashboard/data.json` 未进入提交。
