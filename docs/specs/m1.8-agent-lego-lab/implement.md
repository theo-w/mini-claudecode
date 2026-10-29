# Agent Lego Lab Implementation Record

- Spec：`spec.md`
- Plan：`plan.md`
- Tasks：`tasks.md`
- 状态：Verified
- 实施日期：2026-10-29
- 验证日期：2026-10-29

## 1. 实际交付

M1.8 在现有 Dashboard 增加 `06 乐高实验`。它不是另一张架构图，而是把同一固定任务交给学习者自由装配：

```text
选择零件
→ 运行确定性教学模拟
→ 看动作停在哪
→ 看组件在哪个事件参与
→ 改一个变量再运行
→ 自动比较最近两次
```

八个零件分布在三个平面：

| 平面 | 零件 | 解决的问题 |
|---|---|---|
| 动作 | `read_file` | 模型没有读取能力，只能描述步骤 |
| 动作 | `write_file` | 模型知道怎么改，却不能改变环境 |
| 动作 | `run_python` | 文件可能改了，但没有测试 Observation 支撑交付 |
| 回路 | `loop` | 工具动作执行后，Observation 无法回到下一轮模型 |
| 回路 | `registry` | 工具增加后，手写分发容易产生 Schema、校验和错误结构不一致；不提高固定任务的模型解题能力 |
| 系统 | `guardrail` | 有副作用的工具调用缺少 Harness 层边界与审批检查；不改变任务完成度 |
| 系统 | `trace` | 可以运行，但系统没有可复核的事件证据；不改变任务完成度 |
| 系统 | `eval` | 动作可能全部完成，却无法按任务契约形成 `PASS / FAIL` |

页面支持点按和桌面拖拽。运行时锁定装配，按顺序重放任务、模型、Registry、Guardrail、工具、Observation、Eval 和 Trace 事件，并高亮参加当前事件的零件。结果区同时展示动作完成、任务状态、模型回合、工具调用、模拟耗时和四项系统能力。

四个快速预设形成可重复的对照：

| 预设 | 完成 | 结论 | 工具 | 回合 | 模拟耗时 |
|---|---:|---|---:|---:|---:|
| 只有模型 | 0/3 | `BLOCKED` | 0 | 1 | 0.72s |
| 只加读取 | 1/3 | `INCOMPLETE` | 1 | 1 | 0.90s |
| 能干活 | 3/3 | `UNVERIFIED` | 3 | 4 | 3.42s |
| 完整可信 | 3/3 | `PASS` | 3 | 4 | 3.88s |

最近两次运行自动进入 A/B，比较完成度、任务结论、模拟耗时、工具调用、安全状态和证据状态。页面不合成单一总分。最近六次运行保留在当前页面内存，可载入装配继续修改；刷新后清空。

## 2. 变更文件

| 文件 | 变更 |
|---|---|
| `dashboard/lego.js` | 固定任务、八零件目录、三平面、四预设、确定性模拟、A/B 比较和公开耗时公式 |
| `dashboard/index.html` | 新增 `06 乐高实验` 导航、任务区、零件仓、装配台、结果、A/B 与历史结构 |
| `dashboard/app.js` | 新增装配状态、点按/拖拽、预设、清空、逐事件运行、结果治理、A/B、历史载入 |
| `dashboard/styles.css` | 新增积木卡、三栏工作台、运行高亮、结果分账、A/B、历史与移动端样式 |
| `tests/test_lego_lab.py` | 新增 9 个确定性测试，覆盖目录、预设、断点、状态独立性、耗时、A/B 和无执行通道 |
| `README.md` | 增加版本、玩法、指标与规格入口 |
| `docs/ROADMAP.md` | 增加 M1.8 完成记录与学习层范围 |
| `docs/specs/README.md` | 增加 M1.8 索引 |
| `main.py` | CLI 版本更新为 `v0.10.0` |

## 3. 验收证据

| AC | 证据 | 结果 |
|---|---|---|
| AC-001 | 页面不读取 `data.json` 即可进入乐高视图；全部状态由 `lego.js` 提供 | Pass |
| AC-002 | `test_catalog_has_eight_located_parts_in_three_planes`：八零件顺序为 3/2/3，方法、位置、定义和介入时机非空 | Pass |
| AC-003 | `test_four_presets_are_deterministic_starting_points`：四个预设状态、完成度、调用数、回合数和耗时全部匹配 | Pass |
| AC-004 | `test_read_tool_does_not_claim_write_or_test_completion`：只有读取时为 `1/3 INCOMPLETE`，且明确 Loop 断开 | Pass |
| AC-005 | `test_task_pass_requires_delivery_and_separate_eval`：无 Eval 的 `3/3` 为 `UNVERIFIED`，加 Eval 才为 `PASS` | Pass |
| AC-006 | `test_guardrail_trace_and_eval_remain_independent_claims`：Guardrail 只改安全，Trace/Eval 保持独立证据声明 | Pass |
| AC-007 | `test_compare_runs_exposes_tradeoffs_without_single_score`：A/B 六项差异可见，无总分 | Pass |
| AC-008 | `test_cost_is_explainable_monotonic_and_not_runtime_latency`：链式耗时单调，完整计费公式可复算 | Pass |
| AC-009 | `test_page_contract_is_interactive_and_has_no_real_execution_channel`：页面结构完整，源码无 API 密钥、网络请求或子进程入口 | Pass |
| AC-010 | 浏览器点击验证空装配、完整可信、清空、历史载入与结果面板 | Pass |
| AC-011 | 1440px 与 390px 视口检查无横向溢出；正常分支 console/page error 为 0 | Pass |
| AC-012 | 89/89 测试、Python 编译、四个 JavaScript 语法检查和 `git diff --check` 通过 | Pass |
| AC-013 | README、ROADMAP、规格索引、implement 和 CLI `v0.10.0` 已同步 | Pass |

## 4. 验证命令

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q main.py agent providers tools scripts tests
node --check dashboard/app.js
node --check dashboard/story.js
node --check dashboard/evolution.js
node --check dashboard/lego.js
git diff --check
```

确定性测试结果：

```text
Ran 89 tests in 0.813s
OK
```

浏览器验收结果：

```text
desktop:
  只有模型: BLOCKED · 0/3 · 0.72s
  完整可信: PASS · 3/3 · 3.88s
  A/B: 0/3 → 3/3；BLOCKED → PASS；+3.16s；安全与证据增强
  history: 两次运行保留并可载入装配
  console errors: 0
  page errors: 0
  horizontal overflow: none

mobile:
  viewport override: 390 × 844
  result / A/B / history: reachable
  console errors: 0
  page errors: 0
  horizontal overflow: none
```

## 5. 计划与实际偏差

- 最终实现采用桌面三栏、窄屏堆叠布局；比原计划的简单单列更适合同时观察零件、装配和结果。
- 新增最近六次历史与“载入装配”，用于把一次性演示变成可重复的对照过程；历史只保存在页面内存。
- 页面使用原生 HTML5 拖拽作为辅助操作，同时保留完整点按路径。IAB 自动化环境对合成拖拽支持不稳定，未把拖拽自动事件记为通过；点按、预设与历史载入已完成机器验收。
- 结果没有引入单一 Agent 总分，也没有把模拟耗时包装为真实性能。

## 6. 已知限制

- 固定任务和脚本化模型只用于解释机制，不是模型能力评测；不能据此报告真实成功率。
- 模拟耗时是公开公式的教学估算，不是模型、网络、I/O 或工具执行延迟基准。
- `registry` 在固定任务中不改变完成度；它的价值是多工具契约一致性，页面明确说明“本次未证明”。
- `guardrail` 与 `trace` 可以保持动作完成度不变，只分别改变安全状态和证据状态。
- 本实验没有真实 Trace、没有 Live Eval，也没有进程或文件副作用。
- 拖拽的普通浏览器人工操作未作为唯一入口；点按与拖拽等价，窄屏默认点按。
- 刷新页面会清空历史；当前不保存学习记录，避免未经设计的数据持久化。
- `dashboard/data.json` 是 `local-unredacted`，可能含真实 observation，继续禁止提交或公开分享。

## 7. 失败与负面结果

- 自动化拖拽没有稳定触发 HTML5 Drag & Drop，不能把该交互标记为机器验收通过；对应风险通过等价的点按路径和页面说明缓解。
- “只有模型”的 0/3 是教学设计，不是对任何真实模型的普遍能力判断。
- “完整可信”的 PASS 是固定教学契约的 PASS，不代表生产 Agent 或通用任务可信。
- `registry` 不修复固定任务的模拟断点，说明不是所有新增组件都应被描述成“提升完成率”。

## 8. 后续工作

- 若要把乐高实验升级为真实试跑，必须单独设计 Sandbox、工作区隔离、审批、超时、资源限制和清理。
- 若要加入 Skill，应继续采用“先展示失败模式，再加入最小补丁”的章节结构，并说明其与 Tool 的边界。
- 若要持久化实验历史，应设计版本、脱敏、导出和清理策略。
- 下一阶段进入 M2 验证闭环：`apply_patch`、修改后自动测试和根据错误继续修复。

## 9. 完成声明

- [x] 实现与规格一致
- [x] 验收标准有证据
- [x] 测试和静态检查完成
- [x] 安全边界描述准确
- [x] 文档已同步
