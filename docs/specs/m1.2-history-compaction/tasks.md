# m1.2 History Compaction Tasks

- Spec：[spec.md](spec.md)
- Plan：[plan.md](plan.md)
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
| T001 | 编写压缩触发、边界、证据、协议和回退失败测试 | Spec | AC-001～AC-006、AC-009 | `tests/test_history_compaction.py`（22 tests）、`tests/test_provider.py` | Done |
| T002 | 实现压缩配置、证据提取、策略与协议校验 | T001 | AC-001～AC-004、AC-006 | `agent/compaction.py`、`agent/config.py` | Done |
| T003 | 接入 Agent Loop 与 CLI 压缩配置 | T002 | AC-001、AC-005、AC-009 | `agent/loop.py`、`main.py` | Done |
| T004 | 扩展 Eval 压缩指标、摘要 usage 和策略参数 | T002 | AC-005、AC-007 | `scripts/run_eval.py`、指标测试 | Done |
| T005 | 增加 M1.2 固定任务与任务契约测试 | T003 | AC-008 | `evals/m1_2_tasks.json`、契约测试 | Done |
| T006 | 运行确定性和静态检查 | T001～T005 | AC-010 | 54 tests / compileall / diff check | Done |
| T007 | 运行三策略 Live Eval 与关键组重复运行 | T006 | AC-007、AC-008 | 三策略和重复运行已完成，结果见 Baseline；不代表压缩假设成立 | Done |
| T008 | 编写 ADR、Baseline 与 Implement | T007 | AC-010 | ADR、Baseline、`implement.md` | Done |
| T009 | 同步 README、Roadmap、规格索引并最终复验 | T008 | AC-010 | 文档 diff + 最终命令 | Done |

## 阻塞项

- 无

## 完成检查

- [x] 所有任务 Done 或有明确 Blocked 原因
- [x] 每个 AC 都能追溯到证据
- [x] 未完成项进入下一份规格
