# m1.4 Agent Loop Story Tasks

- Spec：`spec.md`
- Plan：`plan.md`
- 状态：Done
- 验证日期：2026-10-28

## 任务规则

- 任务 ID 稳定，不使用章节编号代替；
- 每个任务以动词开头；
- 每个任务必须有完成证据；
- 状态只能使用 `Pending`、`In Progress`、`Done`、`Blocked`；
- `Done` 必须附测试、Trace、提交或文档证据。

## 任务账本

| ID | 任务 | 依赖 | 对应 AC | 完成证据 | 状态 |
|---|---|---|---|---|---|
| T001 | 编写故事派生与页面结构测试 | Spec | AC-002/003/006/009 | `tests/test_dashboard_story.py` 4 项回归测试；完整套件 66/66 | Done |
| T002 | 实现轮次、工具路径、Loop 和首分叉纯函数 | T001 | AC-002/003/006 | `dashboard/story.js`；Node 断言覆盖 `call_id`、工具/完成分支和首个 check 分叉 | Done |
| T003 | 重构默认任务故事与证据层级 | T002 | AC-001/002/005 | `dashboard/index.html`、`dashboard/app.js`；默认 story，原始 JSON 与 observation 使用原生 details 折叠 | Done |
| T004 | 实现事件驱动回环和真实轮次回放 | T002 | AC-003/007 | 浏览器验收通过：S1-S5 工具回环、S6 完成分支、轮次跳转、播放/暂停和键盘切换 | Done |
| T005 | 实现乐高零件与已用工具突出 | T002 | AC-004 | 浏览器验收通过：当前任务突出 `read_file ×5`，完整工具箱折叠保留 7 个契约；`grep` 仅作为 check 证据出现 | Done |
| T006 | 实现 A/B 首分叉与 Trace 入口 | T002 | AC-006/007 | 浏览器验收定位 `m1_2_failure_recovery`，6 行任务矩阵，两侧 Trace 均可跳转 | Done |
| T007 | 完成桌面、390px、空数据、无效 schema、单运行和离线验收 | T003/T004/T005/T006 | AC-001/004/005/007/008 | Playwright PASS；四视图 390px 无横向溢出；external=0、runtime error=0；截图存档 | Done |
| T008 | 运行完整质量门禁 | T002/T003/T004/T005/T006 | AC-009 | `Ran 66 tests ... OK`；`compileall`、`node --check dashboard/story.js`、`node --check dashboard/app.js`、`git diff --check` 均通过 | Done |
| T009 | 回填实施记录并同步文档版本 | T007/T008 | 全部 | `implement.md`、README、Roadmap、规格索引与 CLI `v0.6.0` 已同步 | Done |

## 阻塞项

- 无

## 完成检查

- [x] 所有任务 Done 或有明确 Blocked 原因
- [x] 每个 AC 都能追溯到证据
- [x] 未完成项进入下一份规格
