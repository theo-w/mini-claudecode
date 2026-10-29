# Agent Lego Usability Repair Implementation Record

- Spec：`spec.md`
- Plan：`plan.md`
- Tasks：`tasks.md`
- 状态：Verified
- 实施日期：2026-10-29
- 验证日期：2026-10-29

## 1. 实际交付

M1.9 保留 M1.8 的确定性教学内核，修正“第一次怎么开始、结果怎么读、改动怎么归因”三个学习断点。

### 1.1 先跑基线，再只加一块

`06 乐高实验` 首屏增加唯一主行动“先跑一次基线”。点击后清空装配并启动运行，首个结果是：

```text
BLOCKED · 0/3
执行边界 UNKNOWN
可审计性 NONE
下一块推荐：read_file
```

运行结束后，推荐卡给出一个确定性的最小补丁。点击“只加一块并再跑”只向当前装配增加一个组件，不会同时修改其他零件。当前实现为减少选择负担只返回一个下一步，同时保留最多 3 个候选的接口约束。

### 1.2 三结论分账

每次运行显示三张独立结论卡：

| 结论 | 来源 | 回答的问题 |
|---|---|---|
| 任务验收 | `taskStatus` | 当前固定任务是否有足够的交付证据形成 `BLOCKED / INCOMPLETE / UNVERIFIED / PASS / FAIL` |
| 执行边界 | `safetyStatus` | 有副作用动作前是否存在 Harness 层 Guardrail 检查 |
| 可审计性 | Trace/Eval 组合 | 是否能复核系统过程并形成独立验收结论 |

可审计性明确分为：

- `NONE`：没有 Trace，页面重放不能冒充系统轨迹；
- `TRACE_ONLY`：有 Trace、没有 Eval；
- `FULL`：Trace 与 Eval 都在。

这与原有 `evidenceStatus` 不同。`EVAL_ONLY` 仍可表示存在验收结论，但因为没有 Trace，三结论中的可审计性仍是 `NONE`，避免把“有结果”误写成“过程可复核”。

### 1.3 语义穷举与 A/B 归因

测试穷举 8 个零件的全部 `2^8 = 256` 种装配，逐项检查：

- 缺少 Guardrail 时，边界不得写成已接通或已通过；
- 缺少 Trace 时，不得声称存在系统轨迹；
- `read_file + write_file + run_python + loop + eval` 可以是任务 `PASS`，但边界必须为 `UNKNOWN`、可审计性必须为 `NONE`；
- narrative 不能再用一句话把任务通过、执行边界、系统轨迹和验收混成“都已接通”。

A/B 比较新增 `changedComponents / addedComponents / removedComponents` 和三种归因模式：

| 模式 | 条件 | 页面提示 |
|---|---|---|
| `repeat` | 0 个组件变化 | 重复运行，确定性模拟应得到相同结果 |
| `controlled` | 恰好 1 个组件变化 | 受控对照，差异可优先归因于这一块 |
| `multivariate` | 2 个及以上组件变化 | 多变量变化，不能把结果差异归因给单一组件 |

### 1.4 零件后果说明与首屏收敛

8 个零件卡新增“缺少它时”的后果说明，把架构名词翻译为学习者能观察到的影响。例如缺少 Loop 时，工具只能响一次，Observation 回不到下一轮模型。

桌面布局把 M1.8 约 799px 的装配区顶部提前到 637px；最后一轮微调从约 687px 再压缩到 637px。桌面三栏中的零件仓和结果面板在大屏进入工作台后 sticky 于 `top: 148px`，到容器末端正常离开。390px 视口改为单列，运行结束后自动将三结论区带入视野。

## 2. 变更文件

| 文件 | 变更 |
|---|---|
| `dashboard/lego.js` | 增加 `missing` 后果说明、三结论、审计性推导、A/B 变化集合与归因模式、单块推荐 |
| `dashboard/index.html` | 增加基线 CTA、`lego-outcomes` 与 `lego-next-experiments` 容器 |
| `dashboard/app.js` | 基线启动、单块补丁、三结论渲染、A/B 警告、窄屏自动滚动、隐藏 run picker |
| `dashboard/styles.css` | 首屏压缩、三结论与推荐卡、桌面 sticky、移动端单列和导航溢出修复 |
| `tests/test_lego_lab.py` | 增加三结论、256 组合语义、A/B 归因、单块推荐和页面契约测试 |
| `README.md` | 更新版本、学习说明、操作路径、测试数量和规格入口 |
| `docs/ROADMAP.md` | 增加 M1.9 完成记录和 M1.9 路线引用 |
| `docs/specs/README.md` | 增加 M1.9 索引 |
| `docs/specs/m1.9-agent-lego-usability/*` | 完成 Spec、Plan、Tasks 与 Implement |
| `main.py` | CLI 版本更新为 `v0.11.0` |

## 3. 验收证据

| AC | 证据 | 结果 |
|---|---|---|
| AC-001 | 页面有唯一 `lego-baseline-button`；`startLegoBaseline` 清空选择后启动运行；Playwright 点击后从 `BLOCKED` 变为可继续推荐 | Pass |
| AC-002 | 390 × 844：基线按钮 `top=297.4px` 且可见；`scrollWidth <= clientWidth` | Pass |
| AC-003 | `test_every_assembly_has_three_independent_and_truthful_outcomes` 检查任务、边界和 Trace/Eval 推导的三结论 | Pass |
| AC-004 | 同一测试穷举 256 个装配，语义断言全部通过 | Pass |
| AC-005 | 8 个零件均有非空 `missing`；页面契约检查“缺少它时”，浏览器卡片可见 | Pass |
| AC-006 | `test_compare_runs_identifies_repeat_controlled_and_multivariate_changes` 覆盖三种模式与警告 | Pass |
| AC-007 | `test_recommendations_are_minimal_single_component_next_experiments` 覆盖 8 个学习断点，候选均只增加一个组件 | Pass |
| AC-008 | 乐高视图 `runPicker.hidden=true`；固定脚本化模型说明仍显示 | Pass |
| AC-009 | 92/92 测试、Python 编译、4 个 JavaScript 语法检查与 `git diff --check` 通过 | Pass |
| AC-010 | README、ROADMAP、规格索引、Implement 和 CLI `v0.11.0` 已同步 | Pass |

## 4. 验证命令

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q agent providers tools scripts main.py tests
node --check dashboard/lego.js
node --check dashboard/app.js
node --check dashboard/evolution.js
node --check dashboard/story.js
git diff --check
```

确定性测试结果：

```text
Ran 92 tests in 0.910s
OK
```

Playwright / 浏览器验收结果：

```text
desktop 1440 × 1000:
  hero top: 153.8px
  hero bottom: 469.3px
  mission bottom: 623px
  workspace top: 637px  (target < 650px)
  baseline visible: true
  run picker hidden: true
  horizontal overflow: 0
  console errors: 0
  page errors: 0

mobile 390 × 844:
  baseline top: 297.4px
  baseline visible: true
  workspace top: 698.6px  (target < 900px)
  horizontal overflow: 0
  console errors: 0
  page errors: 0
  baseline completion auto-scroll: outcomes top = 49px
```

交互验收：

- 空装配基线：`BLOCKED`；边界 `UNKNOWN`；可审计性 `NONE`；
- 只加 `read_file`：A/B 显示“受控对照”；任务 `INCOMPLETE`；下一块为 Tool Loop；
- 同时加 `write_file + run_python`：A/B 显示“多变量变化 · 不能单因归因”；
- 桌面滚入工作台后，零件仓与结果面板 sticky 于 `top: 148px`，到内容末端随容器离开。

## 5. 教学耗时计算说明

模拟耗时来自 `lego.js` 中公开的 `COST_MODEL`：

```text
modelTurnMs          720ms / 模型回合
toolCallMs           180ms / 工具调用
guardrailPerToolMs    45ms / 工具
registryPerToolMs     25ms / 工具
traceFixedMs          20ms 起
traceEventMs           8ms / Trace 事件
evalMs                90ms
```

它由装配、回合和事件数量确定性计算，用于解释“治理组件不是零成本”。它不是模型、网络、I/O 或工具执行延迟，不能作为性能基准，也不能用来推断真实 Agent 的成本优势。

四组预设在当前固定任务上的教学结果为：

| 装配 | 任务 | 完成度 | 工具调用 | 教学模拟耗时 |
|---|---|---:|---:|---:|
| 只有模型 | `BLOCKED` | 0/3 | 0 | 0.72s |
| 只加读取 | `INCOMPLETE` | 1/3 | 1 | 0.90s |
| 能干活 | `UNVERIFIED` | 3/3 | 3 | 3.42s |
| 完整可信 | `PASS` | 3/3 | 3 | 3.88s |

## 6. 计划与实际偏差

- 布局没有继续缩小字号来换取首屏位置，而是压缩 Hero、任务摘要与间距，并保留安全边界说明。
- `recommendNextExperiments` 当前只返回一个最小下一步，符合 Spec 的“最多 3 个”，但比原计划的候选列表更聚焦；接口仍按候选数组组织。
- 大屏采用工作台内 sticky，而不是整页固定；这样离开乐高容器后不会继续遮挡其他内容。
- 浏览器自动化在 IAB/Chrome 环境中完成，未把拖拽作为唯一主路径；点按、预设、推荐补丁和历史载入是完整替代路径。

## 7. 已知限制

- 这是固定任务与脚本化模型的确定性教学模拟，不是真实 Agent 运行，不是 Live Eval，也不是模型能力基准。
- 256 组合穷举验证的是教学状态与文案不越界，不是 256 次真实模型调用。
- 推荐补丁只针对当前固定任务的学习顺序，不能外推为通用 Agent 最佳实践。
- 模拟耗时不是实际延迟，四组耗时不能用于比较供应商或生产架构性能。
- 乐高历史只保存在当前页面内存，刷新即清空，没有持久化学习记录。
- 尚未验证真实学习效果、长期记忆、Skill、MCP、Subagent 或多 Agent 装配。
- “执行边界 PASS”只表示教学脚本的 Guardrail 检查，不代表 OS 级 Sandbox。

## 8. 失败与负面结果

- 首轮移动端回归发现：桌面三栏规则覆盖了旧单列规则，390px 下产生约 322px 横向溢出。通过补充 `max-width: 980px` 的单列规则和导航宽度约束修复，最终溢出为 0。
- 结果语义测试暴露了旧文案把“任务被 Eval 验收”写成“动作链、边界、轨迹和验收都已接通”。M1.9 已把三结论拆开，并保留 `EVAL_ONLY` 仍可能对应可审计性 `NONE` 的反例。
- 多变量 A/B 仍能显示指标差异，但产品上明确禁止单因归因；这不是统计显著性检验。
- 桌面 sticky 在内容末端测得的负 top 是容器结束后的正常离开，不是固定失效。

## 9. 后续工作

- M2 进入真实验证闭环：`apply_patch`、修改后自动测试、根据失败 Observation 继续修复。
- 若把乐高实验升级为真实试跑，需要单独设计 Sandbox、工作区隔离、审批、超时、资源限制和清理。
- 若加入 Skill，应继续按“先展示失败模式，再加入最小补丁”的课程结构解释其与 Tool 的边界。
- 若要评估学习效果，应单独设计用户测试、任务前测/后测和可复现评分，而不是用页面点击行为替代学习结果。

## 10. 完成声明

- [x] 实现与规格一致
- [x] 验收标准有证据
- [x] 测试和静态检查完成
- [x] 安全边界描述准确
- [x] 文档已同步
