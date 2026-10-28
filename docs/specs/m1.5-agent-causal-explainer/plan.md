# m1.5 Agent Causal Explainer Implementation Plan

- Spec：`spec.md`
- 状态：Verified
- 日期：2026-10-28
- 验证日期：2026-10-28
- 关联 ADR：ADR-004 Read-only Agent Anatomy

## 1. 方案摘要

先扩展本地导出器，让任务契约以“Prompt + checks + fixture 摘要”的形式进入 Dashboard 数据；再在 `dashboard/story.js` 增加无 DOM 依赖的 fixture 推导、check 分类、字段匹配因果边和 episode 聚合；最后重构 Story 首屏与 check 展示，并让 Replay/A-B 复用统一状态语义。

该方案不改变 Agent 执行路径，只补齐教学所需的数据与投影逻辑。强因果边严格由相邻真实事件字段相等触发，无法匹配时降级为普通步骤或“未记录”。

## 2. Constitution Check

| 原则 | 影响 | 结论 |
|---|---|---|
| C-01 证据优先 | Prompt、fixture 规模、check 目的与因果边均有文件和 Trace 字段来源 | Pass |
| C-02 最小充分系统 | 只增加静态导出字段与纯函数，不引入框架、服务或运行入口 | Pass |
| C-03 协议正确性 | 不改 Agent 消息协议、工具 Schema 或 tool-call 配对 | Pass |
| C-04 安全边界 | 继续只读；不把 Dashboard 描述为 Sandbox；不执行工具 | Pass |
| C-05 上下文资源 | 导出 fixture 摘要而非正文；页面折叠重复轮次 | Pass |
| C-06 实验可复现 | 任务集显式传入，报告与契约 ID 连接，不猜路径 | Pass |
| C-07 规格先于实现 | 先写 Spec、Plan、Tasks，再进入代码 | Pass |
| C-09 数据卫生 | `data.json` 保持 ignored；fixture 正文不进入导出 | Pass |
| C-10 文档是交付物 | README、Roadmap、Spec 索引和 Implement 同步 | Pass |

## 3. 架构与协议影响

- Agent Loop：无行为变化。
- 消息协议：无变化。
- 工具 Schema：无变化。
- 上下文：无运行期变化；Dashboard 减少 fixture 正文展示。
- Trace：读取既有 events，不补写字段。
- 配置：`scripts/export_dashboard.py` 新增可重复 `--tasks`。
- 数据协议：`schema_version` 仍为 `1`，顶层新增可选 `task_contracts`。
- 安全边界：保持本地只读；浏览器无执行、写文件和外部请求。

## 4. 文件影响

| 文件 | 计划改动 |
|---|---|
| `scripts/export_dashboard.py` | 读取/合并任务集、fixture 摘要、CLI `--tasks`、数据顶层契约 |
| `dashboard/story.js` | metadata 解析、fixture、check 分类/分组、因果链、episode、实验总结 |
| `dashboard/app.js` | Story 实验卡、因果链、episode、分组 checks、takeaways；统一 check 状态 |
| `dashboard/index.html` | 新增 `story-brief`、`story-causal-chain`、`story-takeaways` 容器与教学文案 |
| `dashboard/styles.css` | 实验卡、因果链、episode、check 组、takeaways 与 390px 样式 |
| `tests/test_agent_anatomy.py` | task contract 导入、fixture 摘要、冲突合并与 CLI 测试 |
| `tests/test_dashboard_story.py` | 因果边、不匹配降级、episode、check 状态/分组、页面结构测试 |
| `README.md`、`docs/ROADMAP.md`、`docs/specs/README.md` | 版本、能力、学习路径与索引同步 |
| `docs/specs/m1.5-agent-causal-explainer/implement.md` | 实际交付、证据、偏差和限制 |
| `main.py` | 版本升级到 `v0.7.0` |

## 5. 实施顺序

1. 为任务集导入、fixture 摘要和冲突合并写失败测试。
2. 扩展导出器与 CLI，导出真实 M1.2 契约并检查不含 fixture 正文。
3. 为 check 状态/分组、因果边和 episode 写失败测试。
4. 实现 `story.js` 纯函数，保留 M1.4 API 与测试。
5. 重构 Story 首屏、因果 episode、checks 和 takeaways。
6. 统一 Replay/A-B 的 check 状态语义。
7. 重新导出本地数据，运行完整测试和静态检查。
8. 完成桌面、390px、旧数据、空数据和单运行浏览器 QA。
9. 回填 Implement、README、Roadmap 和版本号；提交推送。

## 6. 测试策略

### 确定性测试

- 正常路径：`24 × 4 + 3 = 99`；5 次连续分页聚为 1 个 episode；四类 checks 分组正确。
- 错误路径：重复 task ID 内容冲突；没有 task contract；check 数据缺失。
- 因果边界：`has_more=true` 且 `next_start_line === start_line` 才生成强 edge；不匹配、`has_more=false`、字段缺失均不生成。
- 状态边界：`skipped=off` 为 SKIP；失败为 FAIL；缺字段为 UNKNOWN；正常通过为 PASS。
- 回归：M1.4 的轮次分组、call_id 配对、Loop journey、A/B 首分叉继续通过。
- 静态结构：页面含实验卡、因果链、takeaways、无 CDN 与无执行入口。

### Live Eval

不新增。此次只改变静态导出和展示，不改变模型、Prompt、工具、审批、上下文或压缩策略；复用三份 M1.2 报告与固定任务集。

### 浏览器验收

- 默认任务显示 Prompt、99 行 fixture 与禁止 grep 的原因。
- 因果 episode 显示 `S1–S5`，展开后可见 `next_start_line → start_line` 的字段匹配。
- compaction check 显示 `SKIP / 策略关闭`。
- Story、Replay、A/B 状态均有文字和形状。
- 旧数据无契约时明确降级；单运行 A/B 仍提示需要两份报告。
- 390px 四视图无横向溢出；0 runtime error、0 external request。

## 7. 安全与失败处理

- 高风险工具：不执行任何工具。
- 审批策略：无变化。
- 超时/取消：无后台任务或播放以外的定时器。
- 数据失败：沿用空数据/无效 schema 错误态；缺契约和未知 check 降级。
- 回滚方式：恢复相关前端与导出器文件，删除新增测试和规格目录。
- 已知限制：任务契约需要人工显式传入；Prompt 与 observation 仍可能含本地数据，不能公开导出文件。

## 8. ADR 需求

不新增 ADR。ADR-004 已决定只读投影、不开放 Web 执行入口；本次仅增强同一投影的数据来源与解释层。若未来增加在线运行、调参或真实因果实验，必须另立 ADR 与规格。

## 9. 交付与验证

- [x] 规格验收映射完整
- [x] 单元测试与静态检查
- [x] Live Eval 不适用及理由已记录
- [x] 真实报告导出与浏览器验证
- [x] 文档和边界更新
