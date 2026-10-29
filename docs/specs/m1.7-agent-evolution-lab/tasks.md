# Agent Evolution Lab Tasks

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
| T001 | 建立 Agent Evolution Lab 的 Spec、Plan 与任务账本 | 无 | AC-001～010 | spec.md / plan.md / tasks.md | Done |
| T002 | 编写课程结构、语义和页面契约失败测试 | T001 | AC-001～009 | `tests/test_evolution_course.py` 覆盖 7 章顺序、唯一答案、失败驱动语义、安全边界、Trace/Eval 与 DOM 契约 | Done |
| T003 | 增加默认课程导航、视图骨架和无数据降级 | T002 | AC-001/008 | `dashboard/index.html` 默认 `build`；`dashboard/app.js` 在 `data.json` 缺失或 404 时保留课程并提供真实数据提示 | Done |
| T004 | 实现 7 章课程数据与 Skill 后续路线 | T002 | AC-002～007 | `dashboard/evolution.js` 提供 7 章、唯一检查题、Tool/Skill 对照、后续路线与 5 条结论 | Done |
| T005 | 实现章节切换、检查题和真实解剖入口 | T003/T004 | AC-002/003/008 | `dashboard/app.js`；上一章/下一章、侧栏章节、进度、答题反馈、标题焦点与真实解剖入口均可用 | Done |
| T006 | 完成课程响应式与可访问性样式 | T005 | AC-010 | `dashboard/styles.css`；1440px/390px 无横向溢出，键盘焦点可见，支持 reduced-motion | Done |
| T007 | 运行确定性测试与浏览器 QA | T006 | AC-001～010 | 80/80 测试通过；Playwright 验证 7 章、答题、键盘、移动端、旧视图与无数据 404 降级 | Done |
| T008 | 回填实现记录并同步 README、ROADMAP、规格索引和版本 | T007 | AC-010 | `implement.md`、README、ROADMAP、规格索引与 CLI `v0.9.0` 已同步 | Done |

## 阻塞项

- 无

## 完成检查

- [x] 所有任务 Done 或有明确 Blocked 原因
- [x] 每个 AC 都能追溯到证据
- [x] 未完成项进入下一份规格
