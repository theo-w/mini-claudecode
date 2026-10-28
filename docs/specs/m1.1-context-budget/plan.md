# m1.1 Context Budget Implementation Plan

- Spec：[spec.md](spec.md)
- 状态：Verified
- 日期：2026-10-28
- 关联 ADR：无

## 1. 方案摘要

采用最小可观测方案：保留现有手写 Agent Loop，不引入 Tokenizer 或上下文压缩框架。在 Provider 边界提取真实 usage；在 Loop 每次调用模型前计算消息与工具 observation 字符快照；在 Tool Registry 中把“静默截断”改为有界、可诊断的截断；在 `read_file` 内按字符预算分页并返回 `next_start_line`。

评测层增加重复行 fixture 生成和上下文指标汇总。用 `scan`、`grep_first`、`multi_file` 三组固定任务得到第一轮探索性数据。

## 2. Constitution Check

| 原则 | 影响 | 结论 |
|---|---|---|
| C-01 证据优先 | 每轮 Token/字符进入 Trace，Eval 自动汇总；不依赖模型自述 | Pass |
| C-02 最小充分系统 | 不引入 Tokenizer、摘要模型或框架，只补当前问题需要的观测与分页 | Pass |
| C-04 安全边界 | 不新增能力；长文件读取仍受 Workspace Guardrail 约束 | Pass |
| C-05 上下文管理 | 本轮只完成预算观测、observation 分页和实验入口；历史压缩明确延期 | Pass，范围受限 |
| C-07 规格先于实现 | Spec、Plan、Tasks 在代码前建立 | Pass |

## 3. 架构与协议影响

- Agent Loop：在 Provider 调用前生成 context snapshot；在响应后记录 usage 和窗口比例。
- 消息协议：不改变 OpenAI messages/tool_calls 结构。
- 工具 Schema：`read_file` 参数保持兼容，仅改进 observation 内容。
- 上下文：新增字符与 Token 观测，不自动裁剪历史。
- Trace：新增 `model_request` 和 `model_response.context_chars/usage/context_usage_ratio`。
- 配置：新增 `CONTEXT_WINDOW_TOKENS`，默认 32768。
- 安全边界：不变。

## 4. 文件影响

| 文件 | 计划改动 |
|---|---|
| `agent/models.py` | 增加 TokenUsage，并挂到 AssistantTurn |
| `agent/context.py` | 新增消息上下文快照 |
| `agent/loop.py` | 记录每轮 context 与 usage |
| `agent/config.py` | 增加上下文窗口配置和校验 |
| `providers/openai_compat.py` | 提取 Chat Completions usage |
| `tools/spec.py` | 有界截断和结构化截断标记 |
| `tools/builtin.py` | read_file 预算内分页和续读元数据 |
| `main.py` | 显示每轮上下文/Token 状态 |
| `scripts/run_eval.py` | fixture 生成、上下文指标、group 汇总 |
| `evals/m1_tasks.json` | 新增 scan、grep-first、multi-file 任务 |
| `tests/` | 增加 usage、context、pagination、fixture 测试 |
| `docs/` | M1 实验记录、README、Roadmap 同步 |

## 5. 实施顺序

1. 先增加上下文与分页失败测试；
2. 实现 TokenUsage、Provider usage 提取和 Loop 快照；
3. 实现 Tool Registry 有界截断与 `read_file` 分页；
4. 增加 M1 fixture 和任务契约测试；
5. 扩展 Eval 指标与 group 汇总；
6. 运行确定性测试；
7. 运行 M1 Live Eval，保存原始 JSON；
8. 根据真实结果写 M1 实验记录和 Implement；
9. 运行基线回归 Eval，更新文档状态。

## 6. 测试策略

### 确定性测试

- 正常路径：带 usage 响应、分页第一页和续读、fixture 展开；
- 错误路径：非法 context window、单行超过预算、缺失 usage；
- 边界条件：observation 正好等于预算、截断后不超过上限、空文件、请求范围超出文件。

### Live Eval

- 使用任务：`evals/m1_tasks.json` 中的 scan、grep-first 和多文件任务；
- 新增检查：目标值必须来自工具 observation；长文件必须发生读取；
- 关注指标：成功率、步数、prompt tokens、context chars、工具 observation 峰值、耗时。

## 7. 安全与失败处理

- 高风险工具：无新增；原有审批策略不变；
- 审批策略：Eval 仍仅在临时目录使用 AutoApprove；
- 超时/取消：沿用现有 Shell/Python timeout；
- 回滚方式：可独立撤回 context 统计和 read_file 分页，原有工具参数兼容；
- 已知限制：无自动摘要、无 Tokenizer、无主动上下文裁剪、每分组样本少。

## 8. ADR 需求

不需要 ADR。本次没有改变长期安全边界、核心协议或不可逆架构；只是增加可观测字段和兼容的 observation 分页。如果 M1.2 决定自动摘要或裁剪历史，再评估 ADR。

## 9. 交付与验证

- [x] 规格验收映射完整
- [x] 单元测试与静态检查
- [x] M1 Live Eval 与基线回归
- [x] 文档和实验记录更新
