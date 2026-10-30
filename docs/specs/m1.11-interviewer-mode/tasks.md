# M1.11 Interviewer Project Brief Tasks

- Spec：`spec.md`
- Plan：`plan.md`
- 状态：Verified

## 任务规则

- 任务 ID 稳定，不使用章节编号代替；
- 每个任务以动词开头；
- 每个任务必须有完成证据；
- 状态只能使用 `Pending`、`In Progress`、`Done`、`Blocked`；
- `Done` 必须附测试、浏览器记录、提交或文档证据。

## 任务账本

| ID | 任务 | 依赖 | 对应 AC | 完成证据 | 状态 |
|---|---|---|---|---|---|
| T001 | 定义 Brief 的问题、目标、非目标、四层证据和验收标准 | Spec | AC-001–AC-011 | `spec.md` | Done |
| T002 | 说明状态机、文件影响、测试、安全和回滚方案 | T001 | AC-001/003/009/010 | `plan.md` | Done |
| T003 | 增加公开 Brief 标签、叙事 DOM 与两个 CTA | T001 | AC-001/004/005/006 | `dashboard/index.html` | Done |
| T004 | 实现公开 `brief/build/lego` 状态机并保持本地七视图入口 | T002/T003 | AC-001/003/007 | `dashboard/app.js`；`node --check` | Done |
| T005 | 完成 Brief 桌面与手机视觉和无溢出布局 | T003 | AC-004/008 | `dashboard/styles.css`；Playwright 截图与尺寸检查 | Done |
| T006 | 固定公开默认入口、公私视图隔离、CTA、证据层与零执行通道契约 | T003/T004 | AC-001–AC-007 | `tests/test_public_demo.py` 8 项通过 | Done |
| T007 | 运行全量测试、Python 编译、JS 语法和格式检查 | T004/T005/T006 | AC-009 | 100 项 unittest 与静态检查 | Done |
| T008 | 验证公开桌面/手机、乐高基线与本地七视图回归 | T004/T005/T006 | AC-001/002/003/005/006/008 | Playwright：1440×1000、390×844、本地七视图 | Done |
| T009 | 同步 README、ROADMAP、规格索引和版本号 | T007/T008 | AC-011 | README / ROADMAP / specs README / `v0.13.0` | Done |
| T010 | 提交、推送并复核 Render 线上入口与数据边界 | T007/T008/T009 | AC-010 | 提交 `28a4b87`；线上 Playwright 三入口、零 `data.json` 请求、`/data.json` 404 | Done |
| T011 | 回填线上部署提交和最终 Verified 状态 | T010 | AC-010/AC-011 | `implement.md` / `spec.md` / `plan.md` / `tasks.md` | Done |

## 阻塞项

- 无。Render 已部署并完成线上复核。

## 完成检查

- [x] 本地任务全部 Done
- [x] 每个 AC 能追溯到测试、浏览器或文档证据
- [x] Render AC-010 线上证据完成
- [x] 未完成项回填为 Verified 或进入下一份规格
