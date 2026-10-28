# m1.3 Agent Anatomy Tasks

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
| T001 | 编写目录、导出和关联失败测试 | Spec | AC-001/002/005 | `tests/test_agent_anatomy.py`：8 个测试；`tests/test_agent_loop.py`：5 个测试 | Done |
| T002 | 实现真实目录与工具事件关联 | T001 | AC-001/005 | `agent/anatomy.py`、`agent/loop.py`、`tests/test_agent_anatomy.py`、`tests/test_agent_loop.py` | Done |
| T003 | 实现多报告本地导出器 | T001 | AC-002/005 | `scripts/export_dashboard.py`；CLI 从仓库根目录直接执行回归测试通过 | Done |
| T004 | 实现架构、Loop 和对比三视图 | T002/T003 | AC-002/003/004/006 | `dashboard/index.html`、`dashboard/styles.css`、`dashboard/app.js`；Playwright 交互通过 | Done |
| T005 | 导出三份真实 M1.2 基线并核对数据 | T003 | AC-002/004 | 本地 `dashboard/data.json`：3 runs、18 records、8 modules、7 tools；文件约 588 KB 且未跟踪 | Done |
| T006 | 验证空数据、交互、响应式和离线行为 | T004/T005 | AC-003/004/006/007 | Playwright：工具跳转 Trace、下一事件、播放/暂停、A/B 交换、checks、空状态、390px 和 0 外部请求 | Done |
| T007 | 运行完整确定性质量门禁 | T002/T003/T004 | AC-007 | `python3 -m unittest discover -s tests -v` 62/62；`compileall`、`node --check`、`git diff --check` 通过 | Done |
| T008 | 回填实施记录与同步项目文档 | T005/T006/T007 | 全部 | `implement.md`、ADR-004、README、Roadmap、规格索引与 `main.py` 版本同步 | Done |

## 阻塞项

- 无

## 完成检查

- [x] 所有任务 Done 或有明确 Blocked 原因
- [x] 每个 AC 都能追溯到证据
- [x] 未完成项进入下一份规格
