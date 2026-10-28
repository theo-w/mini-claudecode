# Spec-Driven Development 工作流

状态：Active
版本：1.0.0
日期：2026-10-28

## 1. 本项目如何使用 SDD

SDD 在本项目中不是“先写一份很长的文档，再开始编码”，也不是瀑布模型。它是一组逐步收敛的契约：

- **Spec** 定义要解决的真实问题和可观察行为；
- **Plan** 决定如何在现有架构与安全边界内实现；
- **Tasks** 把计划拆成可验证的小步；
- **Implement** 记录实际做了什么，以及证据和偏差。

探索可以在任意阶段发生。但只要变更需要保留，结论就必须回填到对应文档。

## 2. 文档职责

| 文档 | 层级 | 回答的问题 | 不负责什么 |
|---|---|---|---|
| `CONSTITUTION.md` | 全局、长期 | 哪些原则不可违背？ | 单次功能细节 |
| `spec.md` | 单个变更 | 为什么做、做什么、怎样算完成？ | 具体代码结构 |
| `plan.md` | 单个变更 | 准备怎样做，影响哪些边界？ | 任务进度 |
| `tasks.md` | 单个变更 | 按什么顺序做，每步如何验证？ | 重复完整需求 |
| `implement.md` | 单个变更 | 实际做了什么，证据是什么，偏离了什么？ | 未来愿望清单 |
| `ADR` | 架构决策 | 为什么选择这个方案，代价是什么？ | 全部需求 |
| `BASELINE.md` | 跨迭代实验 | 在固定条件下指标是多少？ | 单次实现过程 |

`spec`、`plan`、`tasks`、`implement` 属于同一个变更，不应把所有功能塞进一个全局规格文件。

## 3. 目录约定

```text
docs/
  CONSTITUTION.md
  SDD.md
  ROADMAP.md
  BASELINE.md
  decisions/
    ADR-xxx-topic.md
  templates/
    spec.md
    plan.md
    tasks.md
    implement.md
  specs/
    <milestone>-<slug>/
      spec.md
      plan.md
      tasks.md
      implement.md
```

示例：

```text
docs/specs/v0.2.1-harness-baseline/
docs/specs/m1.1-context-budget/
docs/specs/m2.1-patch-and-verify/
```

命名应体现学习阶段和问题，不使用 `misc`、`update`、`new-feature` 等含糊名称。

## 4. 生命周期

```text
Draft → Approved → In Progress → Implemented → Verified
                                      ↘ Superseded
```

状态含义：

- `Draft`：问题和方案仍在讨论；
- `Approved`：范围和验收已确认，可以开始实现；
- `In Progress`：任务正在执行；
- `Implemented`：代码已完成，但证据可能不完整；
- `Verified`：验收、测试、评测和文档检查均完成；
- `Superseded`：被新规格替代，保留用于追溯。

规格和实施记录的初始状态都必须诚实。实施后补写的文档应明确标记为“Backfilled/回溯补全”。

## 5. 各阶段门禁

### 5.1 Spec Gate

在写 Plan 前必须回答：

- 当前真实问题是什么？有没有 Trace 或失败案例支持？
- 本次要改变哪些可观察行为？
- 哪些明确不做？
- 每项需求是否有唯一 ID？
- 每项验收标准是否可以被测试或人工检查？

规格中避免出现“优化体验”“增强能力”这类不可验证表述。

### 5.2 Plan Gate

在拆任务前必须回答：

- 选择这个方案而不是其他方案的理由是什么？
- 是否违反 Constitution？
- 会影响哪些模块、工具 Schema、消息协议或安全边界？
- 如何测试失败路径？
- 如何做 Live Eval？
- 如何回滚？
- 是否需要 ADR？

### 5.3 Tasks Gate

每个任务必须：

- 以动词开头；
- 有唯一 ID；
- 标明依赖；
- 能在一次集中工作中完成；
- 有明确完成证据；
- 避免“实现所有功能”这种无法判断完成的任务。

推荐任务粒度是半天到两天。跨越多天的任务继续拆分。

### 5.4 Implement Gate

实现期间遵守：

- 先写失败测试或固定复现用例，再修复确定性缺陷；
- 不把未声明能力顺带加入；
- 每次改变协议、Prompt 或工具行为都保留 Trace；
- 发现规格错误时先停止扩张范围，更新文档后继续；
- 失败结果不能被“最后一次成功运行”覆盖。

### 5.5 Verification Gate

完成后至少检查：

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q main.py agent providers tools scripts tests
git diff --check
```

影响 Agent 行为时，再运行固定评测：

```bash
python3 scripts/run_eval.py
```

文档变更还需要检查相对链接、文件路径、状态和命令是否有效。

## 6. 需求追踪

使用两类稳定 ID：

- `FR-xxx`：功能需求；
- `NFR-xxx`：非功能需求；
- `AC-xxx`：验收标准；
- `Txxx`：实施任务。

追踪链应为：

```text
FR/NFR → AC → Task → Verification Evidence
```

示例：

```text
FR-004 路径边界
  → AC-002 路径穿越被拒绝
    → T005 实现 Workspace Boundary
      → tests.test_path_traversal_and_sibling_prefix_are_rejected
```

如果某项需求没有对应任务或证据，说明实现或文档仍不完整。

## 7. 证据等级

从高到低：

1. 确定性测试和真实产物检查；
2. 工具执行 Trace 与评测脚本自动检查；
3. 固定任务 Live Eval 的成功率和失败样本；
4. 人工行为观察；
5. 模型最终回答中的自我描述。

低等级证据不能单独证明高等级结论。例如模型说“文件已修改”不能替代文件内容检查。

## 8. 变更管理

### 实现前发现规格错误

更新 `spec.md`，重新检查验收标准，再更新 `plan.md` 和 `tasks.md`。

### 实现中发现更好的方案

如果只影响局部实现，在 `implement.md` 记录偏差；如果影响架构、安全边界或长期成本，新增 ADR。

### 实现失败

保留失败原因和证据。可以缩小范围、修改方案或停止；不能删除失败记录后只展示成功结果。

### 发布和基线

一个变更只有在 `Verified` 后才能进入基线。基线发布后，用新的规格修改行为，不直接覆盖旧基线含义。

## 9. 常见反模式

- 先写代码，再把规格补成“实现说明书”；
- Spec 中直接规定类和函数，却不说明可观察行为；
- 验收标准只有“功能正常”；
- Task 没有证据要求；
- Live Eval 只记录最好的一次；
- 把审批称为 Sandbox；
- 为了展示 Agent 能力引入大量未被验证的工具；
- 失败后删除任务或降低指标定义；
- 在 `implement.md` 写未来计划，却不进入下一阶段规格。

## 10. 当前完整示例

v0.2.1 是一组实施后回溯补全的 SDD 文档：

- [Spec](specs/v0.2.1-harness-baseline/spec.md)
- [Plan](specs/v0.2.1-harness-baseline/plan.md)
- [Tasks](specs/v0.2.1-harness-baseline/tasks.md)
- [Implement](specs/v0.2.1-harness-baseline/implement.md)

下一轮 M1 实验应从模板新建目录，并在编码前完成 Spec Gate。
