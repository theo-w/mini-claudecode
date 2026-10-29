# Agent Lego Lab Tasks

- Spec：`spec.md`
- Plan：`plan.md`
- 状态：Done
- 开始日期：2026-10-29
- 验证日期：2026-10-29

## 任务规则

- 任务 ID 稳定，不使用章节编号代替；
- 每个任务以动词开头；
- 每个任务必须有完成证据；
- 状态只能使用 `Pending`、`In Progress`、`Done`、`Blocked`；
- `Done` 必须附测试、浏览器 QA、提交或文档证据。

## 任务账本

| ID | 任务 | 依赖 | 对应 AC | 完成证据 | 状态 |
|---|---|---|---|---|---|
| T001 | 建立 M1.8 Spec、Plan 与任务账本 | 无 | AC-001～013 | `spec.md` / `plan.md` / `tasks.md` | Done |
| T002 | 定义固定任务、八零件三平面和四个对照预设 | T001 | AC-002/003 | `dashboard/lego.js` 的 `TASK`、`COMPONENTS`、`GROUPS`、`PRESETS` | Done |
| T003 | 编写确定性模拟、断点、状态、耗时与 A/B 测试 | T002 | AC-002～009 | `tests/test_lego_lab.py` 9 个测试方法 | Done |
| T004 | 实现可解释的确定性运行和逐事件 Loop 重放 | T003 | AC-004/005/006/008 | `simulateRun` 与事件日志测试通过 | Done |
| T005 | 增加乐高实验视图、点按/拖拽装配、预设、清空与运行锁定 | T004 | AC-001/003/009/010 | `dashboard/index.html`、`dashboard/app.js` | Done |
| T006 | 实现结果面板、治理分账、最近两次 A/B 与最近六次历史 | T005 | AC-006/007/010 | `renderLegoResult`、`renderLegoCompare`、`renderLegoHistory`；浏览器 QA | Done |
| T007 | 完成三栏装配台、积木视觉、运行高亮和响应式样式 | T006 | AC-010/011 | `dashboard/styles.css`；桌面与窄屏浏览器检查 | Done |
| T008 | 执行 89 项回归与静态检查 | T007 | AC-012 | `Ran 89 tests ... OK`；Python/4 个 JS 检查通过 | Done |
| T009 | 完成浏览器验收并记录真实限制 | T008 | AC-010/011 | 预设、结果、A/B、历史、清空均验证；见 `implement.md` | Done |
| T010 | 同步 README、ROADMAP、规格索引、版本与实现记录 | T009 | AC-013 | 文档更新与 `v0.10.0` | Done |

## 阻塞项

- 无

## 完成检查

- [x] 所有任务 Done 或有明确 Blocked 原因
- [x] 每个 AC 都能追溯到证据
- [x] 未完成项进入下一份规格
