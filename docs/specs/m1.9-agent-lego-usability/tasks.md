# Agent Lego Usability Repair Tasks

- Spec：`spec.md`
- Plan：`plan.md`
- 状态：Done
- 开始日期：2026-10-29

## 任务规则

- 任务 ID 稳定，不使用章节编号代替；
- 每个任务以动词开头；
- 每个任务必须有完成证据；
- 状态只能使用 `Pending`、`In Progress`、`Done`、`Blocked`。

## 任务账本

| ID | 任务 | 依赖 | 对应 AC | 完成证据 | 状态 |
|---|---|---|---|---|---|
| T001 | 建立 M1.9 Spec、Plan 与任务账本 | 无 | AC-001～010 | `spec.md` / `plan.md` / `tasks.md` | Done |
| T002 | 编写三结论、256 组合语义、A/B 与推荐测试 | T001 | AC-003～007 | `tests/test_lego_lab.py` | Done |
| T003 | 扩展 lego 纯函数：missing、outcomes、变化集合与下一实验推荐 | T002 | AC-003～007 | `dashboard/lego.js` | Done |
| T004 | 增加首屏基线 CTA、三结论与引导补丁交互 | T003 | AC-001/003/005/007/009 | `dashboard/index.html` / `dashboard/app.js` | Done |
| T005 | 压缩首屏、增加 sticky 和移动端导航修正 | T004 | AC-002/008 | `dashboard/styles.css` | Done |
| T006 | 完成桌面与移动端 Playwright QA 和全量回归 | T005 | AC-001～009 | 92 项测试通过；桌面/手机尺寸与交互检查通过；无横向溢出 | Done |
| T007 | 回填 implement 并同步 README、ROADMAP、规格索引 | T006 | AC-010 | `implement.md`、README、ROADMAP、规格索引与 CLI 版本已同步 | Done |

## 阻塞项

- 无

## 完成检查

- [x] 所有任务 Done 或明确 Blocked
- [x] 每个 AC 都能追溯到证据
- [x] 未完成项进入下一份规格
