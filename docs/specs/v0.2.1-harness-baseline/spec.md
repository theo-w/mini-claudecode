# v0.2.1 Harness Baseline Specification

- Spec ID：`v0.2.1-harness-baseline`
- 状态：Implemented
- 文档性质：实施后回溯补全（Backfilled）
- 日期：2026-10-28
- 里程碑：M0 Harness 正确性
- 关联 ADR：ADR-001、ADR-002
- 关联基线：[BASELINE.md](../../BASELINE.md)

> 本规格用于完整记录 v0.2.1 的实际行为契约。它在实施后补写，因此不声称曾作为编码前的原始需求文档使用。

## 1. 背景与问题

v0.2 原型已经可以调用模型和工具，但存在以下问题：

- 部分 Tool Schema 不符合 OpenAI Function Calling 结构，模型实际只能看到部分工具；
- 工具调用、Provider、配置和 Trace 混在入口文件中，难以独立验证；
- 路径边界依赖字符串前缀判断，可能把同前缀兄弟目录误认为工作目录；
- 文档把关键词黑名单和 AST 检查描述为“安全沙箱”，夸大了真实隔离能力；
- 写文件和执行工具缺少统一的 Harness 级审批；
- 没有确定性测试、固定评测和可复盘 Trace，无法判断 Agent 行为是否稳定。

这些问题使项目无法成为后续上下文、验证和安全实验的可信基线。

## 2. 目标

建立一个最小但可观察、可测试、可重复运行的 Agent Harness 基线，使后续实验能够比较模型行为和工程策略，而不是只比较功能数量。

## 3. 场景

### 场景 A：读取与报告

用户要求读取工作目录中的文件。Agent 必须调用 `read_file`，根据真实 observation 回答，不能猜测文件内容。

### 场景 B：修改并验证

用户要求创建或修改文件。Harness 必须请求人工审批；批准后执行写入，评测再通过读取真实文件内容判断任务是否完成。

### 场景 C：工具失败后恢复

工具返回文件不存在、参数错误或执行失败。错误必须作为 tool message 回传给模型，Loop 不得崩溃，模型也不能伪造成功。

### 场景 D：路径越权

模型请求读取工作目录外的绝对路径、`..` 路径、同前缀兄弟目录或逃逸符号链接。Harness 必须拒绝，且不泄露目标文件内容。

### 场景 E：模型或策略对比

同一组固定任务可以在不同模型、Prompt 或工具实现下运行，输出成功率、步数、工具错误和耗时。

## 4. 范围

- 手写 OpenAI 兼容 Function Calling Agent Loop；
- 抽出 Agent Loop、Provider、Tool Registry、Trace 和 Config；
- 修复并统一 7 个工具的 Schema；
- 增加工作目录路径 Guardrail；
- 对写文件、Shell 和 Python 执行增加审批；
- Shell 使用 argv 模式，Python 使用独立子进程和超时；
- 建立确定性的 Harness 测试；
- 建立 10 个固定 Live Eval 任务；
- 输出结构化 JSONL Trace；
- 修正安全能力表述并记录架构决策。

## 5. 非目标

- 容器、虚拟机或 OS 级安全隔离；
- 多 Agent 编排；
- Web UI；
- RAG、向量数据库或长期记忆；
- MCP 和 Skill 平台；
- 自动上下文压缩；
- 生产级权限、并发、成本控制或高可用；
- 证明某个模型具备稳定编码能力。

## 6. 功能需求

| ID | 需求 | 优先级 |
|---|---|---|
| FR-001 | 使用 OpenAI 兼容 Function Calling 协议手写 Agent Loop，发送消息与工具 Schema，接收 `tool_calls`，执行工具并继续模型轮次。 | Must |
| FR-002 | 每次工具调用必须生成与 `tool_call_id` 配对的 tool message，保证消息协议完整。 | Must |
| FR-003 | 7 个工具必须具有合法的 `type=function`、`function.name`、`description` 和 JSON Schema `parameters`。 | Must |
| FR-004 | Tool Registry 必须校验必填参数、未声明参数和基础类型；错误返回给模型而不是使 Loop 崩溃。 | Must |
| FR-005 | 文件工具必须通过 `Path.resolve()` 和 `Path.relative_to()` 限制在配置的工作目录内。 | Must |
| FR-006 | 路径穿越、绝对路径越权、同前缀兄弟目录和符号链接逃逸必须被拒绝。 | Must |
| FR-007 | `read_file` 应支持可选行范围，并返回总行数和末尾换行信息。 | Should |
| FR-008 | `write_file`、`run_shell`、`run_python` 必须经过 Harness 级审批；未批准时不得执行。 | Must |
| FR-009 | `run_shell` 必须使用 argv 调用，不启用 `shell=True`，并提供超时和 stdout/stderr 捕获。 | Must |
| FR-010 | `run_python` 必须在独立 Python 子进程中执行，提供超时和 stdout/stderr 捕获。 | Must |
| FR-011 | 配置必须支持本地与云端 OpenAI 兼容 Provider，并允许 CLI 覆盖 Provider 和模型。 | Must |
| FR-012 | 每次运行必须产生可序列化的 Trace，至少覆盖 run、model、tool、approval/error 和 finish 事件。 | Must |
| FR-013 | 必须提供固定任务评测脚本，自动检查工具是否调用、是否失败、最终输出和真实文件产物。 | Must |
| FR-014 | 必须提供不依赖模型服务的确定性测试，覆盖协议、边界和失败路径。 | Must |

## 7. 非功能需求

| ID | 需求 | 约束 |
|---|---|---|
| NFR-001 | 可复现 | 确定性测试不访问模型；Live Eval 固定任务、模型和关键配置。 |
| NFR-002 | 可观察 | 结果不能只依赖模型最终文本，必须保留 Trace 和结构化评测记录。 |
| NFR-003 | 诚实安全 | 没有真实隔离时不得使用“安全 Sandbox”描述；审批和 Guardrail 必须明确区分。 |
| NFR-004 | 最小依赖 | 不引入 Agent 框架；只依赖 OpenAI SDK、dotenv 和 Python 标准库。 |
| NFR-005 | 错误可恢复 | 非法工具名、参数错误、工具失败和最大步数不应使 CLI 进程异常退出。 |
| NFR-006 | 上下文可控 | 单次工具 observation 必须有字符上限，超出时明确截断。 |

## 8. 验收标准

| ID | 验收标准 | 对应需求 | 验证证据 |
|---|---|---|---|
| AC-001 | 7 个工具的 OpenAI Schema envelope 全部合法，名称与 Registry 一致。 | FR-003 | `test_all_tools_have_valid_openai_envelope`、`test_schema_names_match_registry` |
| AC-002 | `ls` 的默认目录参数合法且可省略。 | FR-003/004 | `test_ls_default_argument_is_optional` |
| AC-003 | 路径穿越、绝对路径越权和同前缀兄弟目录被拒绝。 | FR-005/006 | `test_path_traversal_and_sibling_prefix_are_rejected` |
| AC-004 | 指向工作目录外的符号链接不能读取。 | FR-005/006 | `test_symlink_escape_is_rejected` |
| AC-005 | 未批准 `write_file` 时不产生文件。 | FR-008 | `test_write_is_blocked_without_approval` |
| AC-006 | 非法 JSON 参数作为工具错误回传给模型，Loop 可继续。 | FR-004/NFR-005 | `test_malformed_arguments_are_fed_back_to_model` |
| AC-007 | 未知工具不会导致进程崩溃，错误被回传。 | FR-004/NFR-005 | `test_invalid_tool_arguments_do_not_crash_loop` |
| AC-008 | Agent Loop 达到最大步数时强制停止。 | FR-001 | `test_max_steps_is_hard_stop` |
| AC-009 | 成功的工具轮次包含 `tool_call` 和 `tool_result` Trace，并正确配对 tool message。 | FR-012 | `test_tool_call_then_final_answer` |
| AC-010 | 文件读取、搜索、写入、Shell 和 Python 工具在正常路径可用，observation 会被截断。 | FR-007/009/010/NFR-006 | `test_read_grep_find_and_write`、`test_shell_is_argv_only_and_has_no_blacklist_false_positive`、`test_python_runs_in_child_process_and_captures_stdout`、`test_observation_is_truncated` |
| AC-011 | 10 个固定任务包含 CLI 执行、文件检查、失败恢复和 Python 执行场景。 | FR-013 | `evals/tasks.json` 契约检查 |
| AC-012 | README、ADR 和基线准确说明当前能力是 Guardrail + 审批，不是 Sandbox。 | NFR-003 | 文档审阅 |

## 9. 指标

首轮基线记录：

- 固定任务成功率；
- 平均模型轮次；
- 最少/最多模型轮次；
- 工具错误次数；
- 任务和总耗时；
- 每项自动检查通过情况；
- Trace 事件完整性。

当前版本尚未记录 Token、上下文占用、成本或重复运行分布。

## 10. 安全边界

- 文件工具通过路径解析限制在工作目录内。
- `write_file`、`run_shell`、`run_python` 在 Loop 层要求审批。
- 子进程使用缩减后的环境变量、工作目录和超时。
- `run_shell` 不启用 Shell 解释器，但被批准的单个可执行程序仍可能访问宿主资源。
- `run_python` 使用独立解释器和 `-I`，但被批准的代码仍可能访问宿主资源。
- 当前没有网络、CPU、内存、子进程树、文件系统或系统调用的 OS 级隔离。
- 因此当前能力必须称为 **Guardrails + Approval**，不能称为 Sandbox。

## 11. 风险

- 本地模型 Function Calling 能力差异较大，固定任务可能过拟合。
- 单次 Live Eval 是非确定性快照，不能证明稳定成功率。
- 审批只能阻止未经确认的调用，不能限制已批准代码。
- 路径检查无法代替对 TOCTOU、恶意子进程和系统资源的隔离。
- 工具输出仍可能包含敏感文件内容，Trace 分享前需要脱敏。
- 10 个任务覆盖面有限，尚未量化成功率方差。

## 12. 完成条件

- 所有 Must 需求有实现和证据；
- 14 个确定性测试通过；
- 10 个固定评测任务可以执行；
- 最近一次 Live Eval 结果已记录为单次快照；
- ADR、README 和基线明确安全边界；
- 未满足的上下文、验证和隔离能力进入后续里程碑，不在本规格中宣称完成。
