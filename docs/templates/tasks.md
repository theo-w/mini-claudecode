# <变更名称> Tasks

- Spec：`../spec.md`
- Plan：`../plan.md`
- 状态：Draft

## 任务规则

- 任务 ID 稳定，不使用章节编号代替；
- 每个任务以动词开头；
- 每个任务必须有完成证据；
- 状态只能使用 `Pending`、`In Progress`、`Done`、`Blocked`；
- `Done` 必须附测试、Trace、提交或文档证据。

## 任务账本

| ID | 任务 | 依赖 | 对应 AC | 完成证据 | 状态 |
|---|---|---|---|---|---|
| T001 | 编写失败测试或复现用例 | Spec | AC-001 | test name / trace | Pending |
| T002 | 实现最小功能 | T001 | AC-001 | code + test | Pending |
| T003 | 运行固定评测 | T002 | AC-002 | report path | Pending |
| T004 | 更新实现记录与已知限制 | T003 | AC-001/002 | implement.md | Pending |

## 阻塞项

- 无

## 完成检查

- [ ] 所有任务 Done 或有明确 Blocked 原因
- [ ] 每个 AC 都能追溯到证据
- [ ] 未完成项进入下一份规格
