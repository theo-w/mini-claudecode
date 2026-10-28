# v0.2.1 Harness Baseline Tasks

- Spec：[spec.md](spec.md)
- Plan：[plan.md](plan.md)
- 状态：Done
- 文档性质：实施后回溯补全

> 以下任务是按最终实现建立的追溯账本，不代表原始开发时存在同等细度的任务记录。每个 `Done` 都对应可在仓库中检查的证据。

## 任务规则

- `Txxx` 作为稳定追踪 ID；
- 任务以可交付行为为边界，不以文件数量衡量；
- 每个任务必须关联需求或验收标准；
- 只有存在测试、Trace、文档或命令证据时才能标记 `Done`。

## 任务账本

| ID | 任务 | 依赖 | 对应需求/验收 | 完成证据 | 状态 |
|---|---|---|---|---|---|
| T001 | 盘点并修复 7 个工具 Schema | Spec | FR-003、AC-001、AC-002 | `tests/test_tool_schema.py` | Done |
| T002 | 抽出模型数据结构与 Provider 适配 | T001 | FR-001、FR-011 | `agent/models.py`、`providers/openai_compat.py` | Done |
| T003 | 实现 Function Calling Agent Loop 与 tool message 配对 | T002 | FR-001、FR-002 | `agent/loop.py`、`test_tool_call_then_final_answer` | Done |
| T004 | 实现 ToolSpec、Registry 与参数校验 | T003 | FR-003、FR-004、NFR-005 | `tools/spec.py`、非法参数与未知工具测试 | Done |
| T005 | 实现工作目录 Guardrail 和路径逃逸测试 | T004 | FR-005、FR-006、AC-003、AC-004 | `tools/builtin.py`、路径与符号链接测试 | Done |
| T006 | 实现高风险工具审批 | T003/T004 | FR-008、AC-005 | `agent/approval.py`、`test_write_is_blocked_without_approval` | Done |
| T007 | 将 Shell 改为 argv，将 Python 改为独立子进程 | T005 | FR-009、FR-010、AC-010 | `test_shell_is_argv_only_and_has_no_blacklist_false_positive`、`test_python_runs_in_child_process_and_captures_stdout` | Done |
| T008 | 实现 observation 截断与分段读取 | T004/T007 | FR-007、NFR-006、AC-010 | `test_read_grep_find_and_write`、`test_observation_is_truncated` | Done |
| T009 | 实现配置、Trace 与精简 CLI | T002/T003 | FR-011、FR-012、AC-009 | `agent/config.py`、`agent/trace.py`、`main.py`、Loop Trace 测试 | Done |
| T010 | 建立 10 个固定评测任务和自动检查器 | T001–T009 | FR-013、AC-011 | `evals/tasks.json`、`scripts/run_eval.py` | Done |
| T011 | 完成 Live Eval 并记录单次基线 | T010 | FR-013、NFR-001 | `docs/BASELINE.md`、本地 `eval-20261028-083259.json` | Done |
| T012 | 修正安全表述并记录 ADR | T005–T007 | NFR-003、AC-012 | `README.md`、ADR-001、ADR-002 | Done |
| T013 | 完成确定性检查和文档收口 | T001–T012 | 全部 Must AC | 14/14 测试、compileall、diff check、JSON 契约检查 | Done |
| T014 | 补齐 SDD 文档体系 | T013 | Constitution、Spec、Plan、Tasks、Implement | 本目录与 `docs/SDD.md`、模板 | Done |

## 依赖关系

```text
T001 → T002 → T003 → T004 → T005 → T007 → T008
                     ↘ T006
T002/T003 → T009
T001–T009 → T010 → T011
T005–T007 → T012
T001–T012 → T013 → T014
```

## 并行可能性

- T005 与 T006 在 Registry 契约稳定后可并行；
- T009 可以与工具实现并行，只要消息协议结构已确定；
- T010 可在工具契约稳定后开始，但最终任务检查必须等待实现完成；
- T012 可以在实现完成后与评测并行编写，但必须用真实边界复核。

## 未完成与阻塞

- 无当前阻塞项。
- M1 上下文预算、Token 统计、上下文压缩不在本任务清单内。
- M2 `apply_patch` 与自动测试修复闭环不在本任务清单内。

## 完成检查

- [x] 所有任务 Done
- [x] Must 需求均有实现或文档证据
- [x] 14 个确定性测试通过
- [x] 10 个固定 Live Eval 任务存在
- [x] 至少一次完整 Live Eval 已运行
- [x] 安全边界已写入 README 和 ADR
- [x] 已知限制进入 M1-M4 路线
