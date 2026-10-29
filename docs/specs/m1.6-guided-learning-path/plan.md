# m1.6 Agent Guided Learning Path Implementation Plan

- Spec：`spec.md`
- 状态：Verified
- 日期：2026-10-29
- 验证日期：2026-10-29
- 关联 ADR：无（延续 ADR-004 的只读边界）

## 1. 方案摘要

不重构导出器和数据 schema，而是在现有 Dashboard 前增加一个“开始学习”视图。学习视图复用 `AgentStory.summarizeExperiment`、`groupRounds`、`toolPath`、checks 和 catalog 数据，把现有证据压缩成五步：四张故事卡结论、组件地图、真实 Loop、测试语义、复盘。Story、Replay、Anatomy、Compare 保留为深挖入口。

同时修复 `observationSummary` 对分页元数据的解释，并增加 `continuationGap` 纯函数，把“文件仍有后续但下一轮停止调用工具”变成可测试、可展示的可观察事件。这个方案避免在长报告上继续堆文案，也不引入新的数据来源或运行时。

## 2. Constitution Check

| 原则 | 影响 | 结论 |
|---|---|---|
| C-01 证据优先 | 所有学习文案来自 record、checks、Trace、catalog 或 task contract；continuation gap 有纯函数测试 | Pass |
| C-02 最小充分系统 | 只增加前端学习视图和两个 Story 语义修正，不引入框架、后端或新数据 schema | Pass |
| C-03 协议正确性 | 不改变消息、工具或 Loop 协议；修复的是展示层对分页字段的误解 | Pass |
| C-04 安全边界 | 页面仍只读，不执行 Agent 或工具；不改变审批和 Sandbox 声明 | Pass |
| C-05 上下文管理 | 学习视图降低首屏信息量，但不改变 Agent 上下文策略 | Pass |
| C-06 可复现 | 确定性测试使用现有 JSON 与合成 Trace；不新增 Live Eval | Pass |
| C-07 规格先于实现 | 先建立 Spec、Plan、Tasks，再改代码 | Pass |
| C-08 小步可逆 | 变更集中在 Dashboard 三个前端文件、Story 纯函数、测试和文档 | Pass |
| C-09 数据卫生 | 不提交 ignored 的 `data.json`，不读取或导出敏感 fixture 正文 | Pass |
| C-10 文档交付 | SDD、README、Roadmap、规格索引同步 | Pass |

## 3. 架构与协议影响

- Agent Loop：无变化；仅新增对现有 Trace 的学习投影。
- 消息协议：无变化。
- 工具 Schema：无变化。
- 上下文：无变化；页面读取已有 context snapshot。
- Trace：无变化；新增 `continuationGap` 与修复 observation 摘要。
- 配置：无变化。
- 安全边界：保持只读；不增加 `fetch` 目标、表单提交或执行入口。

## 4. 文件影响

| 文件 | 计划改动 |
|---|---|
| `dashboard/index.html` | 增加默认学习 Tab、学习面板、步骤导航和深挖入口占位 |
| `dashboard/app.js` | 增加学习状态、五步渲染、组件地图、Loop 教学卡和测试分层；同步 task select |
| `dashboard/story.js` | 修复 `observationSummary`；新增 `continuationGap` 纯函数 |
| `dashboard/styles.css` | 增加学习视图布局、组件车道、步骤导航、测试摘要和移动端样式 |
| `tests/test_dashboard_story.py` | 增加 observation 语义、continuation gap 和默认学习视图结构测试 |
| `README.md` | 说明学习路径的入口和使用方式 |
| `docs/ROADMAP.md` | 记录 M1.6 只提升可解释性、不新增 Live Eval |
| `docs/specs/README.md` | 增加 M1.6 规格索引 |
| `main.py` | 版本号升级到 v0.8.0（仅当 README 同步） |

## 5. 实施顺序

1. 增加 `continuationGap` 和 observation 语义测试，复现默认失败任务的 `1–44 / 85` 证据；
2. 修改 `story.js`，让分页摘要正确区分请求范围与文件剩余；
3. 在 `index.html` 增加默认学习 Tab 和五步容器，保留现有四视图；
4. 在 `app.js` 增加学习状态与五步渲染，复用现有 run/record 选择；
5. 增加 CSS，保证桌面组件车道和 390px 移动端可读；
6. 更新测试、README、Roadmap、规格索引和 Implement 记录；
7. 进行 Node/Python/静态/浏览器验证。

## 6. 测试策略

### 确定性测试

- 正常路径：`has_more=false` 且 `file_has_more=true` 时摘要说明文件仍有后续；
- 错误路径：`file_has_more=true` 后下一轮无 tool call 时返回 continuation gap；
- 边界条件：下一轮继续读取时返回空；缺失 `file_has_more` 时不生成强结论；
- 结构测试：默认 Tab 为学习路径，五步容器和四个深挖入口存在。

### Live Eval

- 不新增 Live Eval。此变更是展示层和摘要语义修正，不改变 Agent 行为或任务判定。
- 使用现有 M1.2 导出数据做真实浏览器验收：`m1_2_todo_fixme` 应显示两次 `read_file`、1–44 行、85 行 fixture 和下一轮停止。

## 7. 安全与失败处理

- 高风险工具：无新增；页面不执行工具。
- 审批策略：无变化。
- 超时/取消：无变化。
- 回滚方式：删除学习视图和 `continuationGap` 改动即可恢复旧页面；旧数据 schema 不变。
- 已知限制：学习路径基于单次 Trace，不提供统计因果结论；组件卡片中的“本次状态”只代表当前 record。

## 8. ADR 需求

不需要新 ADR。方案沿用 ADR-004 的只读投影边界，不改变架构决策。

## 9. 交付与验证

- [x] 规格验收映射完整
- [x] 单元测试与静态检查
- [x] Live Eval 明确不适用
- [x] 文档和基线更新
