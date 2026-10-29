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
- [m1.3 Agent Anatomy](m1.3-agent-anatomy/spec.md)（已验证，M1 第三阶段；真实数据只读拆解与 A/B 对比，不新增 Live Eval）
- [m1.4 Agent Loop Story](m1.4-agent-loop-story/spec.md)（已验证，M1 第四阶段；任务故事、真实 Loop、乐高工具插槽与 A/B 首分叉，不新增 Live Eval）
- [m1.5 Agent Causal Explainer](m1.5-agent-causal-explainer/spec.md)（已验证，M1 第五阶段；任务契约、fixture、字段因果、episode、check 教学与单次 A/B 边界，不新增 Live Eval）
- [m1.6 Agent Guided Learning Path](m1.6-guided-learning-path/spec.md)（已验证，M1 第六阶段；默认五步学习、四张故事卡、组件装配、测试语义与深挖证据，不新增 Live Eval）
- [m1.7 Agent Evolution Lab](m1.7-agent-evolution-lab/spec.md)（已验证，M1 第七阶段；7 章从零建造、失败驱动的最小补丁、检查题与 Skill 后续路线，不新增 Tool、Live Eval 或网页执行能力）

完整流程见 [../SDD.md](../SDD.md)，项目原则见 [../CONSTITUTION.md](../CONSTITUTION.md)。
