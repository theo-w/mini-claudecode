# m1.4 Agent Loop Story Implementation Plan

- Spec：`../spec.md`
- 状态：Done
- 日期：2026-10-28
- 关联 ADR：ADR-004 Read-only Agent Anatomy（延续）

## 1. 方案摘要

保留现有 Python 导出 schema 和真实数据，在浏览器侧增加一个无 DOM 依赖的 `story.js`，把 Trace 转换为模型轮次、工具路径和 A/B 分叉。`app.js` 负责把这些确定性结果渲染成默认任务故事、环形 Loop、乐高零件和证据详情。

这是最小充分方案：当前字段已经足以回答“发生了什么”，问题在信息架构而非数据采集；因此不修改协议，也不增加执行能力。

## 2. Constitution Check

| 原则 | 影响 | 结论 |
|---|---|---|
| C-01 证据优先 | 故事、路径和分叉均由 Trace/checks 派生，并保留原始证据入口 | Pass |
| C-02 最小充分系统 | 复用 schema v1 与原生静态页面，不引入框架或后端 | Pass |
| C-03 协议正确性 | 不修改消息、工具调用或 `call_id` 关联协议 | Pass |
| C-04 安全边界 | 页面仍为只读，不执行工具；不把 observation 截断当脱敏 | Pass |
| C-05 上下文 | 展示真实上下文/Token 数据，不新增压缩行为 | Pass |
| C-06 可复现 | UI 算法对同一 JSON 确定性输出；不新增 Live Eval | Pass |
| C-07 规格先于实现 | 先完成 Spec/Plan/Tasks Gate，再改页面 | Pass |
| C-08 小步可逆 | 只需回退三个前端文件、story.js、测试和文档 | Pass |
| C-09 数据卫生 | 沿用 ignored 的 `local-unredacted` 数据文件 | Pass |

## 3. 架构与协议影响

- Agent Loop：无行为变化；仅改变已有事件的视觉表达。
- 消息协议：无变化。
- 工具 Schema：无变化。
- 上下文：无变化；只读取已有 turn/usage 数据。
- Trace：无 schema 变化；前端从现有 `step`、`call_id`、`event`、`checks` 派生故事。
- 配置：无变化。
- 安全边界：仍无工具执行、无网络依赖、无在线调参。

## 4. 文件影响

| 文件 | 计划改动 |
|---|---|
| `dashboard/story.js` | 新增纯函数：轮次分组、工具路径、observation 摘要、Loop 路径和 A/B 首分叉 |
| `dashboard/index.html` | 默认“任务故事”，新增实际 Loop、轮次故事、已用零件和首分叉容器 |
| `dashboard/styles.css` | 重做故事层级、回环、乐高插槽、证据折叠和响应式 |
| `dashboard/app.js` | 接入 story 数据，调整视图、回放详情、工具高亮和 A/B 渲染 |
| `tests/test_dashboard_story.py` | 通过 Node 固定纯函数行为和页面结构 |
| `README.md` | 更新 v0.6.0、四视图说明和验证方式 |
| `docs/ROADMAP.md` | 记录 M1.4 展示层补强及不改变 Agent 行为 |
| `docs/specs/README.md` | 增加 m1.4 索引 |
| `docs/specs/m1.4-agent-loop-story/tasks.md` | 实施任务账本 |
| `docs/specs/m1.4-agent-loop-story/implement.md` | 真实验收、偏差与限制 |
| `main.py` | 同步命令行版本号 |

## 5. 实施顺序

1. 先用 Node 可执行测试固定轮次分组、工具路径、Loop 分支和 A/B 分叉。
2. 实现 `story.js` 纯函数并通过测试。
3. 重构 HTML 信息架构，保持现有空数据和 tools dialog。
4. 重写 `app.js` 的故事、回放和对比渲染，接入纯函数。
5. 重做 CSS，先保证桌面叙事，再处理 390px。
6. 使用三份真实 M1.2 报告导出并做浏览器交互与网络验证。
7. 回填 Tasks、Implement、README、Roadmap 和版本号。

## 6. 测试策略

### 确定性测试

- 正常路径：同一 step 的 request/response/tool_call/tool_result 分组，`call_id` 匹配结果。
- 分支路径：有 tool call 的轮次为 `tool`，无 tool call 的最终响应为 `finish`。
- 摘要路径：`read_file` observation 显示返回范围、是否还有更多内容；未知文本截断而不补造语义。
- 比较路径：首个失败/通过不同的任务、首个不同 check；无差异返回空。
- 边界条件：无 step 事件、缺 call_id、缺 checks、单运行。
- 静态结构：默认 tab 为 story，原始 JSON 使用 details，页面不引入 CDN。

### 浏览器验收

- 真实导出：3 runs / 18 records / 8 modules / 7 tools；
- 默认任务故事：轮次、实际工具路径、最终响应和 checks；
- 事件回放：下一步、播放、环形节点更新、原始 JSON 默认折叠；
- 乐高视图：已用工具优先，未用工具仍可展开和搜索；
- A/B：首分叉定位、任务矩阵和 Trace 跳转；
- 空数据、单运行、390px、0 runtime error、0 external request。

### Live Eval

不新增。此次不改变 Agent、模型、Prompt、工具、审批、上下文或压缩行为，复用既有 M1.2 报告作为真实数据快照。

## 7. 安全与失败处理

- 高风险工具：只展示契约，不执行。
- 审批策略：不变。
- 超时/取消：无后台任务。
- 数据失败：沿用空数据和错误状态；故事算法对缺失字段降级显示“未记录”。
- 回滚方式：恢复前端文件并删除 `story.js` 和对应测试；无数据迁移。
- 已知限制：报告没有原始自然语言 Prompt；不能展示模型内部推理，只能展示输入摘要、输出事件和 checks。

## 8. ADR 需求

不新增 ADR。ADR-004 已决定只读投影和拒绝 Web 执行入口；本轮的叙事层与默认视图属于该决策内的展示优化。若未来增加运行或调参，必须另立 ADR 和规格。

## 9. 交付与验证

- [x] 规格验收映射完整
- [x] 单元测试与静态检查（66/66，Node 语法与 `git diff --check` 通过）
- [x] Live Eval 不适用及理由已记录
- [x] 真实报告导出与浏览器验证（含空数据、无效 schema、单运行和 390px）
- [x] 文档和边界更新
