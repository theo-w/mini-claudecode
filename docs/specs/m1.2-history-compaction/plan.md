# m1.2 History Compaction Plan

- Spec：[spec.md](spec.md)
- 状态：Verified
- 日期：2026-10-28

## 1. 方案摘要

采用“滚动摘要 + 确定性证据账本”的最小方案：

1. Agent Loop 在每轮模型调用前检查上一轮真实 prompt Token；
2. 达到阈值后，把最新 user 消息之前的历史和最近窗口之前的旧消息压缩为一条 system 摘要；
3. `extractive` 从工具调用和 observation 中提取来源、行号、错误、TODO 和任务关键标识；
4. `model` 使用同一 Provider 做一次无工具摘要调用，失败时回退 `extractive`；
5. 原始 observation 继续保留在 Trace，只有下一次模型请求看到压缩后的消息；
6. Eval 对同一任务集分别运行三种策略并汇总主模型与摘要模型成本。

不引入 Tokenizer、向量库或持久化记忆。触发依据是真 usage，不用字符数伪造 Token。

## 2. Constitution Check

| 原则 | 影响 | 结论 |
|---|---|---|
| C-01 证据优先 | 压缩事件、摘要 usage、原文 Trace 和固定任务检查都落盘 | Pass |
| C-02 最小充分系统 | 只实现 off/extractive/model 三种最小策略，不引入记忆框架 | Pass |
| C-03 协议正确性 | 压缩边界按完整 tool-call 组调整，并有配对测试 | Pass |
| C-04 安全边界 | 摘要调用无工具、无新增文件或执行能力；不称为 Sandbox | Pass |
| C-05 上下文管理 | 比较成功率、信息损失和成本，而不是只证明函数存在 | Pass |
| C-06 可复现实验 | 固定任务、模型、窗口、阈值、命令和原始报告进入 Baseline | Pass |
| C-07 规格先于实现 | Spec、Plan、Tasks、ADR 在代码前建立 | Pass |
| C-08 小步可逆 | 默认 `off`；模块可独立回滚，消息协议不变 | Pass |
| C-09 数据卫生 | 文档不提交密钥；Trace/Eval 仍需分享前脱敏 | Pass |
| C-10 文档是交付物 | README、Roadmap、ADR、Baseline、Implement 同步 | Pass |

## 3. 架构与协议影响

- 新增 `agent/compaction.py`，负责边界选择、证据提取、模型摘要和结果数据；
- `AgentLoop` 保存上一轮主模型 prompt Token，在下一轮前调用压缩器；
- 压缩后消息顺序为：system 消息、压缩摘要 system 消息、最新 user、受保护最近窗口；
- 摘要消息使用明确的 `[COMPACTED_HISTORY_V1 ...]` 标记；
- 若最近窗口从 tool message 开始，向前扩展边界以包含对应 assistant tool call；
- 无法证明协议安全时不做破坏性压缩，记录失败并保留原消息；
- Provider 接口和工具 Schema 不变；
- 模型摘要调用 `provider.complete(summary_messages, [])`，响应中的工具调用视为失败；
- Trace 增加 `history_compaction`、`compaction_model_request`、`compaction_model_response` 和 `compaction_model_error`。

## 4. 文件影响

| 文件 | 计划改动 |
|---|---|
| `agent/compaction.py` | 新增压缩策略、证据提取、边界与协议校验 |
| `agent/config.py` | 增加策略、触发 Token、保留窗口和摘要上限配置 |
| `agent/loop.py` | 接入触发、压缩事件和上一轮 usage 状态 |
| `agent/context.py` | 统计消息角色与压缩摘要，支持 Eval 观测 |
| `scripts/run_eval.py` | 增加策略参数、摘要 usage 和压缩指标 |
| `main.py` | 显示压缩配置并传递到 AgentLoop |
| `tests/test_history_compaction.py` | 新增确定性、协议、回退和指标测试 |
| `evals/m1_2_tasks.json` | 新增证据保留、错误、TODO、近窗口和重复压缩任务 |
| `docs/decisions/ADR-003-history-compaction.md` | 记录滚动摘要与回退取舍 |
| `docs/M1_2_COMPACTION_BASELINE.md` | 记录实验条件、结果和限制 |
| `README.md`、`docs/ROADMAP.md`、`docs/specs/README.md` | 同步能力和 M1 状态 |
| `.env.example` | 增加压缩配置示例 |

## 5. 数据流

```text
主模型响应 usage
    ↓
prompt_tokens >= threshold ?
    ↓ yes
选择旧消息边界（保留 system / latest user / recent window）
    ↓
extractive: 证据提取并去重
或
model: 无工具摘要调用 → 空/异常/工具响应则 fallback extractive
    ↓
替换为一条有界 system 摘要
    ↓
校验 tool_call/tool message 配对
    ↓
下一次主模型请求
```

## 6. 实施顺序

1. 写压缩边界、证据、协议、触发和回退失败测试；
2. 实现配置与 `agent/compaction.py`；
3. 接入 Agent Loop 和 CLI；
4. 扩展 Eval，增加三种策略参数与摘要成本指标；
5. 增加 M1.2 固定任务和任务契约测试；
6. 运行确定性测试和静态检查；
7. 运行 `off`、`extractive`、`model` 对照 Live Eval；
8. 如时间允许重复运行最关键的 `extractive` 组，记录稳定性而非只选最好结果；
9. 写 ADR、Baseline 和 Implement，更新 README/Roadmap；
10. 最终复验、提交和推送。

## 7. 测试策略

### 确定性测试

- 正常路径：extractive 摘要保真、模型摘要成功、重复压缩去重；
- 阈值路径：低于阈值、达到阈值、usage 缺失；
- 错误路径：模型异常、空摘要、摘要返回 tool call；
- 协议路径：最近窗口以 tool message 开始、多工具调用、压缩后配对；
- 成本路径：Eval 同时统计主模型和摘要模型 usage；
- 边界路径：摘要不超过上限、消息数不增加、空历史 no-op。

### Live Eval

- 同一任务集分别运行 `off`、`extractive`、`model`；
- 固定低阈值以强制在任务中途触发，但记录这是实验配置；
- 关注成功、步数、主/摘要 Token、总 Token、峰值上下文、压缩次数和回退；
- 对关键值、错误和 TODO 使用最终输出与 Trace 双重检查；
- 至少重复运行关键组一次；若服务失败，保留中止记录而非删除。

## 8. 安全与失败处理

- 高风险工具：无新增；
- 模型摘要：不提供工具 Schema，失败不终止主循环；
- 审批策略：Eval 继续只在临时目录使用 AutoApprove；
- 超时/取消：沿用 Provider 请求超时，不新增并发；
- 回滚方式：设置 `COMPACTION_STRATEGY=off` 即恢复 M1.1 行为；
- 已知限制：响应前无法精确预估 Token；模型摘要仍可能语义失真；不保证跨模型稳定。

## 9. ADR 需求

需要 ADR-003。该变更引入了对消息历史的破坏性替换、额外模型调用和滚动摘要失真风险，属于需要长期记录的架构取舍。ADR 将说明默认关闭、证据优先、模型失败回退和原 Trace 保留。

## 10. 交付与验证

- [x] 规格验收映射完整
- [x] 单元测试与静态检查
- [x] 三种策略 Live Eval 与必要重复运行
- [x] 文档、ADR、Baseline 和 Implement 更新

实际偏差和实验限制由 [implement.md](implement.md) 记录；Live Eval 未证明压缩成功率收益。
