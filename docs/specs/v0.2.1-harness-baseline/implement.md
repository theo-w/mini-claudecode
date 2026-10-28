# v0.2.1 Harness Baseline Implementation Record

- Spec：[spec.md](spec.md)
- Plan：[plan.md](plan.md)
- Tasks：[tasks.md](tasks.md)
- 状态：Verified
- 实施日期：2026-10-28
- Baseline：[BASELINE.md](../../BASELINE.md)

> 本记录在实现完成后回溯补全。代码、测试和结果来自当前工作区，不虚构原始提交时间线。

## 1. 实际交付

v0.2.1 已形成一个可运行的本地学习基线：

- 使用 OpenAI 兼容 Function Calling 的手写 Agent Loop；
- 7 个工具和统一 Schema/Registry；
- 工作目录路径 Guardrail；
- 写文件与执行工具的 Harness 级审批；
- Shell argv 执行和 Python 独立子进程；
- 结构化 JSONL Trace；
- 本地/云端模型配置与交互 CLI；
- 14 个确定性测试；
- 10 个固定 Live Eval 任务；
- Spec、Plan、Tasks、Implement、ADR、Roadmap 和 Baseline 文档。

## 2. 变更文件

| 文件 | 实际变更 |
|---|---|
| `main.py` | 改为 CLI 组装入口，支持 Provider、模型、工作区和步数覆盖 |
| `agent/loop.py` | 实现模型轮次、工具执行、审批、错误回传和最大步数停止 |
| `agent/models.py` | 定义 ToolCall、AssistantTurn 和 RunResult |
| `agent/prompts.py` | 更新工具使用、验证和安全边界要求 |
| `agent/approval.py` | 提供自动批准、全部拒绝和交互审批 |
| `agent/config.py` | 增加模型与 Harness 配置读取和验证 |
| `agent/trace.py` | 实现 JSONL 事件追加与内存事件列表 |
| `providers/openai_compat.py` | 封装 Chat Completions Function Calling |
| `tools/spec.py` | 实现工具契约、注册表、参数校验和截断 |
| `tools/builtin.py` | 实现 7 个工具、工作目录边界和子进程执行 |
| `tests/` | 增加 14 个确定性测试 |
| `evals/tasks.json` | 增加 10 个固定任务 |
| `scripts/run_eval.py` | 增加自动检查、结果 JSON 和完整事件记录 |
| `docs/` | 增加 SDD 文档、ADR、路线和基线 |

## 3. 验收证据

| AC | 证据 | 结果 |
|---|---|---|
| AC-001 | `test_all_tools_have_valid_openai_envelope`、`test_schema_names_match_registry` | Pass |
| AC-002 | `test_ls_default_argument_is_optional` | Pass |
| AC-003 | `test_path_traversal_and_sibling_prefix_are_rejected` | Pass |
| AC-004 | `test_symlink_escape_is_rejected` | Pass |
| AC-005 | `test_write_is_blocked_without_approval` | Pass |
| AC-006 | `test_malformed_arguments_are_fed_back_to_model` | Pass |
| AC-007 | `test_invalid_tool_arguments_do_not_crash_loop` | Pass |
| AC-008 | `test_max_steps_is_hard_stop` | Pass |
| AC-009 | `test_tool_call_then_final_answer` | Pass |
| AC-010 | 文件、Shell、Python 和截断测试 | Pass |
| AC-011 | 10 个任务 JSON 契约检查 | Pass |
| AC-012 | README、ADR-002 和 BASELINE 人工审阅 | Pass |

## 4. 验证命令与结果

### 4.1 确定性测试

```bash
python3 -m unittest discover -s tests -v
```

结果：

```text
Ran 14 tests in 0.044s
OK
```

### 4.2 静态编译

```bash
python3 -m compileall -q main.py agent providers tools scripts tests
```

结果：`compileall: OK`。

### 4.3 补丁卫生

```bash
git diff --check
```

结果：通过，无空白错误。

### 4.4 评测任务契约

对 `evals/tasks.json` 执行 JSON 解析、唯一 ID、`max_steps >= 1`、检查类型和任务数量验证。

结果：

```text
eval contract: OK (10 tasks)
```

### 4.5 Live Eval 快照

- 时间：2026-10-28 08:32:59
- 模型：`glm-4.7-flash:latest`
- 结果：10/10
- 成功率：100%
- 平均模型轮次：2.50
- 最少/最多轮次：2 / 5
- 总耗时：146.42 秒
- 工具错误：1（任务 08 预期的文件不存在错误）

完整结果由 `evals/results/eval-20261028-083259.json` 本地保存，但该目录被 `.gitignore` 忽略。可追踪摘要见 [BASELINE.md](../../BASELINE.md)。

## 5. 计划与实际偏差

1. **安全能力从“Sandbox”改为“Guardrails + Approval”**
   v0.2 的 Shell 黑名单和 Python AST 扫描可被绕过。最终实现删除这类安全宣传，增加审批并保留宿主访问风险说明。

2. **Shell 从字符串命令改为 argv**
   当前不支持管道、重定向和 Shell 展开。这是有意的能力收缩，换取调用边界更清晰。

3. **Python 从 AST 检查改为独立子进程**
   子进程只解决执行隔离形态、超时和输出捕获，不等于安全隔离；被批准代码仍可访问宿主资源。

4. **测试数量为 14 个**
   早期文档曾写 13 个，最终按 `unittest` 实际发现数量修正为 14 个。

5. **Live Eval 只保留一次最终快照作为基线**
   开发过程中存在未全通过的运行。最终 10/10 是迭代后的单次结果，因此不能用于估计稳定成功率或运行方差。

6. **SDD 文档为实施后补全**
   当时没有完整的 Constitution → Spec → Plan → Tasks → Implement 过程记录；本次按真实实现回溯补齐，并明确标注。

## 6. 已知限制

- 当前没有 Token、成本或上下文占用统计；
- observation 只有字符截断，没有上下文压缩和摘要；
- `write_file` 仍为整文件覆盖，没有 `apply_patch`；
- 评测不会自动运行项目测试或进入修复循环；
- 工具错误没有区分预期错误与意外错误；
- 10 个任务覆盖面有限，单次 Live Eval 不稳定；
- 审批不构成 Sandbox；
- 没有网络、CPU、内存、子进程树或系统调用级隔离；
- Trace 可能包含文件内容和工具输出，分享前必须检查敏感信息；
- 本记录生成时，当前工作区变更尚未作为正式版本提交到 GitHub。

## 7. 失败与负面结果

- 安全边界最初被描述为“沙箱”，但实现无法阻止被批准代码或多种绕过方式，因此该假设不成立。
- 关键词黑名单会误伤合法命令且不能提供可靠安全边界，最终删除该策略。
- 本地模型的单次 10/10 不能证明稳定编码能力；开发中的其他运行并非全部通过。
- 固定 10 个任务不足以证明泛化能力。

## 8. 后续工作

M1 应建立 `m1.1-context-budget` 规格，先回答：

- 每轮输入/输出 Token 和字符数如何记录？
- 长文件在整文件、分页和摘要压缩下的成功率差异是什么？
- 什么条件会导致上下文耗尽或关键信息丢失？

M1 完成前不引入 MCP、Web UI、多 Agent 或向量数据库。

## 9. 完成声明

- [x] 实现与规格一致，偏差已记录
- [x] 所有 Must AC 有证据
- [x] 确定性测试和静态检查完成
- [x] Live Eval 已记录为单次快照
- [x] 安全边界描述准确
- [x] 文档已同步
- [x] 未完成能力已进入后续里程碑
