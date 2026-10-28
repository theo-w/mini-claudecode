# m1.3 Agent Anatomy Implementation Plan

- Spec：`spec.md`
- 状态：Verified
- 日期：2026-10-28
- 关联 ADR：ADR-004 Read-only Agent Anatomy

## 1. 方案摘要

采用“Python 只读导出器 + 原生静态网页”。Python 从真实 registry 和 Eval JSON 生成单一 `dashboard/data.json`；浏览器只读取该文件，不执行 Agent。这样可复用现有数据契约、避免重复实现评测逻辑，也不需要引入前端或后端框架。

## 2. Constitution Check

| 原则 | 影响 | 结论 |
|---|---|---|
| C-01 证据优先 | 所有卡片来自 registry，所有运行路径来自 Trace；无数据时不造 demo。 | Pass |
| C-02 最小充分系统 | 原生 HTML/CSS/JS 与标准库导出器，解决 JSON 难以复盘的问题。 | Pass |
| C-04 安全边界 | 不提供执行按钮；明确本地数据、非脱敏和非 Sandbox 边界。 | Pass |
| C-07 规格先于实现 | Spec/Plan/Tasks 先于编码建立，Implement 回填证据。 | Pass |
| C-09 数据卫生 | 生成数据入 Git ignore，报告路径仅保留 basename，不导出未知顶层字段。 | Pass |

## 3. 架构与协议影响

- Agent Loop：仅在工具相关事件增加 `call_id`，不改变控制流。
- 消息协议：不变。
- 工具 Schema：不变；目录只读反射现有 Schema。
- 上下文：不变；绘制已有 turns 和事件指标。
- Trace：新增关联字段；旧事件通过导出器兼容。
- 配置：不变；展示报告已有配置，不伪造未记录值。
- 安全边界：新增本地静态读取界面，不增加执行能力。

## 4. 文件影响

| 文件 | 计划改动 |
|---|---|
| `agent/anatomy.py` | 模块元数据、真实工具目录和源码位置 |
| `agent/loop.py` | 工具事件补充 `call_id` |
| `scripts/export_dashboard.py` | 多报告校验、兼容关联、内容上限与 JSON 导出 |
| `dashboard/index.html` | 三视图语义结构 |
| `dashboard/styles.css` | 卡片、流程图、时间线、图表和响应式样式 |
| `dashboard/app.js` | 数据加载、筛选、回放、对比和详情渲染 |
| `tests/test_agent_anatomy.py` | 目录、导出、关联、隐私和空数据测试 |
| `tests/test_agent_loop.py` | 新 Trace `call_id` 协议测试 |
| `.gitignore` | 忽略生成的 Dashboard 数据 |
| `README.md` / `docs/ROADMAP.md` / `docs/specs/README.md` | 使用方式、边界与路线同步 |
| `docs/decisions/ADR-004-read-only-agent-anatomy.md` | 只读投影与本地数据决策 |

## 5. 实施顺序

1. 用单元测试固定目录、Trace 关联、导出与旧报告兼容行为。
2. 实现目录、Trace 字段和导出器。
3. 实现静态页面三视图与无数据状态。
4. 从三份真实 M1.2 报告生成本地数据并核对数值。
5. 运行确定性测试和浏览器桌面/窄屏/交互/离线验证。
6. 回填 Implement、Tasks、README、Roadmap 和已知限制。

## 6. 测试策略

### 确定性测试

- 正常路径：七工具目录、源码位置、多报告导出、三视图所需字段。
- 错误路径：报告缺字段、label 数量不一致、未知事件、长内容截断。
- 边界条件：旧事件无 `call_id`、同轮相同工具、无数据文件、缺失 usage/commit。
- 协议：新 tool call/result/error/approval 事件保持相同 `call_id`。

### Live Eval

不新增 Live Eval。此次没有模型、Prompt、工具 Schema、审批、上下文或压缩行为变化；唯一 Loop 改动是附加 Trace 字段。复用三份已存在的真实报告验证读取与展示，并明确这些报告仍是单次快照。

## 7. 安全与失败处理

- 高风险工具：只展示契约，不提供执行。
- 审批策略：不变。
- 超时/取消：不运行后台任务，无新增进程控制。
- 数据失败：无数据或 JSON 无效时展示错误与导出命令。
- 回滚方式：删除静态页面、导出器和附加 Trace 字段即可回退，无持久化迁移。
- 已知限制：本地导出文件不是公开安全格式，旧数据关联可能是推断。

## 8. ADR 需求

需要 ADR。Web UI 是 Constitution 中原先审慎引入的能力，必须记录为什么现在只读可视化是最小充分方案，以及为什么拒绝在此阶段增加交互执行后端。

## 9. 交付与验证

- [x] 规格验收映射完整
- [x] 单元测试与静态检查：62/62、compileall、node --check、git diff --check
- [x] Live Eval 不适用及理由已记录
- [x] 真实报告导出与浏览器验证：3 runs / 18 records / 0 external requests
- [x] 文档和边界更新：README、Roadmap、Tasks、Implement、ADR
