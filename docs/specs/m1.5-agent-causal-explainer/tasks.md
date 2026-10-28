# m1.5 Agent Causal Explainer Tasks

- Spec：`spec.md`
- Plan：`plan.md`
- 状态：Done
- 开始日期：2026-10-28
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
| T001 | 编写任务契约导入与 fixture 摘要失败测试 | Spec | AC-001/002 | `tests/test_agent_anatomy.py` 覆盖 `24 × 4 + 3 = 99`、fixture 正文不导出、重复契约合并与冲突拒绝；完整套件 74/74 | Done |
| T002 | 扩展导出器与 CLI `--tasks` | T001 | AC-001/002 | `scripts/export_dashboard.py` 支持可重复 `--tasks`；真实 M1.2 导出得到 3 次运行、18 条任务记录、6 份契约 | Done |
| T003 | 编写 check、因果边与 episode 失败测试 | T002 | AC-005/006/007/008 | `tests/test_dashboard_story.py` 覆盖字段相等/不匹配、缺失字段、连续分页、check 分组与 SKIP 语义 | Done |
| T004 | 实现 Story 纯函数 | T003 | AC-005/006/007 | `dashboard/story.js` 提供 metadata、fixture、check、因果链、episode 与实验总结函数；Node 语法检查通过 | Done |
| T005 | 重构实验卡、因果链、episode 与 takeaways | T004 | AC-003/004/005/006/009 | `index.html`、`app.js`、`styles.css`；默认任务显示 99 行 fixture、S1–S5 episode、4 条强字段边与 5 条 takeaways | Done |
| T006 | 统一 Story、Replay、A/B check 语义 | T004/T005 | AC-007/008 | 三处复用 `PASS / FAIL / SKIP / UNKNOWN` 的符号、文字与样式；A/B 缺失 check 显示 UNKNOWN | Done |
| T007 | 完成完整测试和静态检查 | T005/T006 | AC-009 | `Ran 74 tests ... OK`；`compileall`、两个 `node --check`、`git diff --check` 全部通过 | Done |
| T008 | 完成桌面、390px、旧数据与单运行 QA | T005/T006 | AC-003/004/010 | Playwright 覆盖 1440px/390px 四视图；无横向溢出、runtime error=0、external request=0；旧数据与单运行降级通过 | Done |
| T009 | 回填实施记录并同步文档版本 | T007/T008 | 全部 | `implement.md`、Spec/Plan 状态、README、Roadmap、规格索引与 CLI `v0.7.0` 已同步 | Done |

## 阻塞项

- 无

## 完成检查

- [x] 所有任务 Done 或有明确 Blocked 原因
- [x] 每个 AC 都能追溯到证据
- [x] 未完成项进入下一份规格
