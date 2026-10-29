# M1.10 Public Learning Demo Tasks

- Spec：`spec.md`
- Plan：`plan.md`
- 状态：Verified

## 任务规则

- 任务 ID 稳定，不使用章节编号代替；
- 每个任务以动词开头；
- 每个任务必须有完成证据；
- 状态只能使用 `Pending`、`In Progress`、`Done`、`Blocked`；
- `Done` 必须附测试、Trace、提交或文档证据。

## 任务账本

| ID | 任务 | 依赖 | 对应 AC | 完成证据 | 状态 |
|---|---|---|---|---|---|
| T001 | 编写公开模式、数据卫生与 Render 配置失败测试 | Spec | AC-001/002/005/006 | `tests/test_public_demo.py` | Done |
| T002 | 实现公开模式识别、导航裁剪与 `data.json` 请求短路 | T001 | AC-001/002/006 | `dashboard/app.js` + 全量测试 | Done |
| T003 | 调整公开模式页头标识、课程状态与最终 CTA | T002 | AC-003 | `dashboard/index.html` / `app.js` + 浏览器 QA | Done |
| T004 | 增加 Render 静态站点配置 | T001 | AC-005/007 | `render.yaml` | Done |
| T005 | 验证本地完整七视图无回归 | T002/T003 | AC-004 | Playwright 本地模式 | Done |
| T006 | 验证公开模式桌面与移动端交互、无错误和无溢出 | T002/T003 | AC-001/002/003 | Playwright 双视口 | Done |
| T007 | 创建 Render 服务并验证线上基线交互 | T004/T006 | AC-007 | [Render 线上页面](https://mini-agent-harness.onrender.com/)：HTTP 200，Playwright 基线 `BLOCKED / UNKNOWN / NONE`，`data.json` 请求 0，错误 0，溢出 0 | Done |
| T008 | 更新 README、ROADMAP、规格索引和实现记录 | T002/T004 | AC-005 | README、ROADMAP、spec 索引、implement 验收记录 | Done |
| T009 | 将项目与线上 Demo 回填简历站 | T007 | AC-007 | 简历站 `index.html`：最近动态 + `PRJ-05` 项目卡，含 GitHub 与线上 Demo | Done |

## 阻塞项

- 无

## 完成检查

- [x] 所有任务 Done 或有明确 Blocked 原因
- [x] 每个 AC 都能追溯到证据
- [x] 未完成项进入下一份规格
