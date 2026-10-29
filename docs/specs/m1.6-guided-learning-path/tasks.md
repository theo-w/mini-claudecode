# m1.6 Agent Guided Learning Path Tasks

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
- `Done` 必须附测试、Trace、提交或文档证据。

## 任务账本

| ID | 任务 | 依赖 | 对应 AC | 完成证据 | 状态 |
|---|---|---|---|---|---|
| T001 | 编写分页语义与 continuation gap 失败测试 | Spec | AC-008/AC-009 | `tests/test_dashboard_story.py` 新增 `test_observation_summary_distinguishes_request_and_file_remainder` 与 `test_reports_continuation_gap_only_when_next_turn_stops` | Done |
| T002 | 修复 observation 摘要并实现 continuation gap | T001 | AC-005/008/009 | `dashboard/story.js` 区分 `has_more` 与 `file_has_more`；`continuationGap()` 只在 `file_has_more=true` 且下一轮停止时返回结构化证据 | Done |
| T003 | 增加默认学习视图和五步导航 | T002 | AC-001/003/007 | `dashboard/index.html` 默认 `data-view="learn"`；`dashboard/app.js` 提供看结论、认零件、看循环、懂测试、做复盘五步 | Done |
| T004 | 实现四张故事卡、组件车道、Loop 教学区和测试分层 | T003 | AC-003/004/005/006 | 默认任务显示任务/过程/断点/裁判四卡；10 张可展开组件卡；S1–S3 Loop 摘要与断点；四类测试表及折叠证据 | Done |
| T005 | 增加响应式与渐进披露样式 | T004 | AC-002/006 | `dashboard/styles.css`；原始 Trace、逐条 check 默认折叠；1440px 与 390px Playwright 无横向溢出 | Done |
| T006 | 运行完整确定性测试与静态检查 | T002-T005 | AC-010 | `python3 -m unittest discover -s tests -v`：76/76 PASS；`compileall`、两个 `node --check`、`git diff --check` 通过 | Done |
| T007 | 完成浏览器回归和网络/控制台检查 | T005 | AC-002/003/004/005/006/007 | Playwright 五步切换、组件展开、S3 Replay 跳转、测试抽屉均通过；console error=0、page error=0、external request=0 | Done |
| T008 | 回填 Implement、README、Roadmap 和索引 | T006/T007 | 全部 | 新增 `implement.md`；README、Roadmap、规格索引与 CLI `v0.8.0` 同步 | Done |

## 阻塞项

- 无

## 完成检查

- [x] 所有任务 Done 或有明确 Blocked 原因
- [x] 每个 AC 都能追溯到证据
- [x] 未完成项进入下一份规格
