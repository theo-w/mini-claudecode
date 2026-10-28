# v0.2.1 Harness Baseline Implementation Plan

- Spec：[spec.md](spec.md)
- 状态：Executed（实施后回溯补全）
- 日期：2026-10-28
- 关联 ADR：[ADR-001](../../decisions/ADR-001-function-calling-loop.md)、[ADR-002](../../decisions/ADR-002-guardrails-not-sandbox.md)

> 本计划按最终实现所需的架构回溯整理，用于形成后续可复用的规划模板。它不是原始项目排期记录；真实实现和偏差见 [implement.md](implement.md)。

## 1. 方案摘要

采用 OpenAI 兼容 Function Calling 协议手写最小 Agent Loop，不引入 LangGraph、Agent SDK 或自研 Text ReAct Parser。将入口拆分为 Provider、Loop、Tool Registry、Approval、Config 和 Trace 六个边界，使协议、工具、权限和观测可以分别测试。

安全策略不做“黑名单假装沙箱”。当前只提供路径 Guardrail、审批、argv 执行和超时，并把真正的隔离推迟到容器/OS 阶段。

## 2. Constitution Check

| 原则 | 影响 | 结论 |
|---|---|---|
| C-01 证据优先 | 增加确定性测试、Trace 和固定评测 | Pass |
| C-02 最小充分系统 | 不引入框架、MCP、Web UI、多 Agent | Pass |
| C-03 协议正确性 | 统一 Tool Schema 与 tool message 配对 | Pass |
| C-04 诚实安全边界 | 删除 Sandbox 宣传，新增审批、保留宿主访问风险声明 | Pass |
| C-05 上下文管理 | 增加 observation 字符上限与分段读取；压缩留到 M1 | Partial，已记录为后续 |
| C-06 可复现实验 | 固定任务和模型配置，Live Eval 结果结构化 | Pass |
| C-07 规格先于实现 | 本次文档回溯补全，已明确标记 | Backfilled |
| C-08 小步可逆 | 拆分核心模块，不扩展非目标能力 | Pass |

## 3. 架构与协议

### 3.1 运行链路

```text
CLI
  → Config
  → OpenAICompatibleProvider
  → AgentLoop
      → ToolRegistry.openai_schemas()
      → Provider.complete(messages, tools)
      → message + tool_calls
      → JSON 参数校验
      → Approval（高风险工具）
      → ToolRegistry.invoke()
      → tool message
      → EventTracer
  → RunResult
```

### 3.2 核心边界

- `agent/loop.py`：控制模型轮次、工具执行、审批、错误回传和停止条件；
- `providers/openai_compat.py`：隔离 OpenAI Chat Completions 适配；
- `tools/spec.py`：工具契约、Registry 和参数校验；
- `tools/builtin.py`：文件、搜索和执行工具的实现与工作目录边界；
- `agent/approval.py`：可替换的审批策略；
- `agent/config.py`：模型与 Harness 配置；
- `agent/trace.py`：结构化事件记录；
- `main.py`：CLI 组装与交互，不承载 Agent 核心逻辑；
- `scripts/run_eval.py`：固定任务执行和独立检查；
- `tests/`：不依赖模型的确定性测试。

### 3.3 协议选择

- 继续使用 Chat Completions Function Calling；
- 每个 assistant tool call 必须对应一个 tool message；
- 工具错误也是正常 tool message，不抛出到 CLI 主循环；
- 最大步数按模型调用轮次计，而非工具调用次数；
- 多个 tool call 在当前版本顺序执行，避免并发写副作用。

## 4. 文件影响

| 文件 | 计划改动 |
|---|---|
| `main.py` | 缩减为 CLI 与组件组装入口 |
| `agent/loop.py` | 实现 Function Calling Loop、审批和 Trace |
| `agent/models.py` | 定义 ToolCall、AssistantTurn、RunResult |
| `agent/prompts.py` | 明确工具、验证、权限和安全边界 |
| `agent/approval.py` | AutoApprove、DenyAll、InteractiveApproval |
| `agent/config.py` | 本地/云端模型与 Harness 配置 |
| `agent/trace.py` | JSONL 事件记录 |
| `providers/openai_compat.py` | OpenAI 兼容 Provider 适配 |
| `tools/spec.py` | ToolSpec、ToolRegistry、参数校验 |
| `tools/builtin.py` | 7 个工具、工作目录 Guardrail、子进程执行 |
| `tests/` | Schema、Loop、路径与工具确定性测试 |
| `evals/tasks.json` | 10 个固定任务 |
| `scripts/run_eval.py` | 评测器与结果输出 |
| `docs/` | Spec、Plan、Tasks、Implement、ADR、Roadmap、Baseline |

## 5. 实施顺序

1. 盘点并修复 7 个工具的 Schema 与 Registry；
2. 抽出模型数据结构、Provider 和 Agent Loop；
3. 引入 ToolSpec、参数校验和错误回传；
4. 实现工作目录 Guardrail 与高风险工具审批；
5. 把 Shell 改为 argv、Python 改为独立子进程；
6. 实现配置、Trace 和缩减后的 CLI；
7. 编写确定性测试，先覆盖协议和边界失败；
8. 建立固定任务与评测检查；
9. 运行 Live Eval，记录单次基线；
10. 修正安全文档，完成最终检查和偏差记录。

## 6. 测试策略

### 确定性测试

- Schema envelope 合法且名称一致；
- 路径穿越、绝对路径、同前缀目录和符号链接逃逸；
- 未审批写操作不产生副作用；
- 非法 JSON 参数、未知工具和类型错误不崩溃；
- 最大步数硬停止；
- Shell argv 正常执行；
- Python 子进程输出捕获；
- observation 截断；
- tool message 与 tool call ID 配对。

### Live Eval

- 任务集：`evals/tasks.json`，共 10 个任务；
- 覆盖：ls、read_file、grep、find、write_file、read-then-write、run_python；
- 检查：工具调用、工具成功/失败、最终输出、文件状态和内容；
- 指标：成功率、平均步数、工具错误、耗时、完整事件；
- 运行环境：每个任务独立临时目录；评测使用 AutoApprove。

## 7. 安全与失败处理

- 文件工具统一通过 `Workspace.resolve()`；
- 高风险工具由 Loop 在调用前审批；未提供策略时默认拒绝；
- 未批准调用返回 tool message，而不是静默忽略；
- Shell 使用 `shlex.split()` 生成 argv，不启用 `shell=True`；
- Python 使用 `sys.executable -I -c` 和 timeout；
- 子进程环境只保留 PATH、HOME、TMPDIR、编码和 LANG；
- 不宣称上述措施是 OS 级隔离；
- 回滚方式是按模块撤回拆分并恢复 v0.2 原型，但当前基线不提供自动迁移。

## 8. ADR 需求

- 需要 ADR-001：说明为什么手写 Function Calling Loop；
- 需要 ADR-002：说明为什么当前执行能力是 Guardrail 而不是 Sandbox；
- 不需要为单个工具实现新增 ADR，除非改变权限或协议边界。

## 9. 交付检查

- [x] Spec 需求与验收映射
- [x] 架构和文件影响明确
- [x] 确定性测试策略
- [x] Live Eval 策略
- [x] 安全边界与回滚说明
- [x] 实施后补全真实证据
