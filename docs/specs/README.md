# 规格目录

每个非平凡变更使用一个独立目录：

```text
<milestone>-<slug>/
  spec.md
  plan.md
  tasks.md
  implement.md
```

创建方式：

```bash
mkdir -p docs/specs/m1.1-context-budget
cp docs/templates/spec.md docs/specs/m1.1-context-budget/spec.md
cp docs/templates/plan.md docs/specs/m1.1-context-budget/plan.md
cp docs/templates/tasks.md docs/specs/m1.1-context-budget/tasks.md
cp docs/templates/implement.md docs/specs/m1.1-context-budget/implement.md
```

不要把多个不相关功能塞进同一个规格。旧规格完成后保留，状态改为 `Verified` 或 `Superseded`。

## 已有规格

- [v0.2.1 Harness Baseline](v0.2.1-harness-baseline/spec.md)（回溯补全，已实现）
- [m1.1 Context Budget](m1.1-context-budget/spec.md)（已验证，M1 第一阶段）
- [m1.2 History Compaction](m1.2-history-compaction/spec.md)（已验证，M1 第二阶段；机制通过，成功率收益未证明）

完整流程见 [../SDD.md](../SDD.md)，项目原则见 [../CONSTITUTION.md](../CONSTITUTION.md)。
