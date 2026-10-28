# m1.1 Context Budget Tasks

- Spec：[spec.md](spec.md)
- Plan：[plan.md](plan.md)
- 状态：Done

## 任务规则

- 每个任务以动词开头；
- 每个任务必须关联 AC；
- 只有存在测试、Trace、Eval 或文档证据时才能标记 Done；
- 未完成或失败项保留真实原因。

## 任务账本

| ID | 任务 | 依赖 | 对应 AC | 完成证据 | 状态 |
|---|---|---|---|---|---|
| T001 | 编写 usage、context snapshot、分页和 fixture 失败测试 | Spec | AC-001～AC-006 | `tests/test_context_budget.py` | Done |
| T002 | 实现 TokenUsage、Provider usage 提取与 Context Snapshot | T001 | AC-001、AC-002 | `agent/models.py`、`agent/context.py`、`providers/openai_compat.py`、`agent/loop.py` | Done |
| T003 | 实现上下文窗口配置与 CLI 显示 | T002 | AC-003 | `agent/config.py`、`main.py`、`test_context_window_config_is_validated` | Done |
| T004 | 实现有界截断与 read_file 分页 | T001 | AC-004、AC-005 | `tools/spec.py`、`tools/builtin.py`、分页与截断测试 | Done |
| T005 | 增加重复行 fixture 与 M1 任务集 | T004 | AC-006 | `scripts/run_eval.py`、`evals/m1_tasks.json`、`test_m1_task_contract` | Done |
| T006 | 扩展 Eval Token、上下文与 group 指标 | T002/T005 | AC-007 | `scripts/run_eval.py`、`test_aggregate_and_group_metrics` | Done |
| T007 | 运行确定性和静态检查 | T002～T006 | AC-008 | 28/28 tests、compileall、diff check | Done |
| T008 | 运行 M1 Live Eval 与基线回归 | T007 | AC-007 | `m1-20261028-091040.json`、`m1-regression-local-20261028-091130.json` | Done |
| T009 | 编写 M1 实验记录与 Implement | T008 | FR-008 | `docs/M1_CONTEXT_BASELINE.md`、`implement.md` | Done |
| T010 | 同步 README、Roadmap、规格索引并完成复验 | T009 | FR-008、AC-008 | 文档 diff + 最终命令 | Done |

## 阻塞项

- 无

## 完成检查

- [x] 所有任务 Done 或有明确 Blocked 原因
- [x] 每个 AC 都能追溯到证据
- [x] 未实现项进入下一份规格
