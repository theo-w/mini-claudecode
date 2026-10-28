# Mini-ClaudeCode / Mini Agent Harness

一个用于系统学习 Agent 工程的最小代码 Agent Harness。项目目标不是再实现一个 Claude Code，而是把 Agent 的关键机制做成可运行、可观察、可评测的实验底座。

当前版本：**v0.4.0 M1.2 History Compaction**。首轮 Harness 基线见 [docs/BASELINE.md](docs/BASELINE.md)，M1.1 上下文实验见 [docs/M1_CONTEXT_BASELINE.md](docs/M1_CONTEXT_BASELINE.md)，M1.2 历史压缩实验见 [docs/M1_2_COMPACTION_BASELINE.md](docs/M1_2_COMPACTION_BASELINE.md)。

## 现在能学到什么

- OpenAI 兼容的 Function Calling 消息协议
- 模型驱动循环、工具注册表与工具参数契约
- 文件搜索、读取、写入和执行型工具
- 工作目录边界与 Harness 层人工审批
- 结构化 JSONL 运行轨迹
- Token usage、上下文字符与工具 observation 观测
- 长文件预算内分页与续读元数据
- 基于真实 `prompt_tokens` 触发的历史压缩：`off`、`extractive`、`model`，默认 `off`
- 证据保留摘要、模型摘要无工具调用、异常回退和主/摘要模型 usage 分账
- 压缩只影响下一次模型请求，原始工具 observation 仍保留在 Trace
- 固定任务评测、成功率、步数、Token、上下文、压缩成本和 group 统计
- 本地模型与云端模型切换

## SDD 规范驱动开发

项目使用 Spec-Driven Development 管理每次能力演进：

- [CONSTITUTION.md](docs/CONSTITUTION.md)：长期工程原则与不可妥协边界
- [SDD.md](docs/SDD.md)：Spec → Plan → Tasks → Implement → Verify 工作流
- [规格目录](docs/specs/README.md)：每个变更的完整文档集合
- [v0.2.1 完整示例](docs/specs/v0.2.1-harness-baseline/spec.md)：Harness 基线的 Spec、Plan、Tasks 和 Implement
- [m1.1 Context Budget](docs/specs/m1.1-context-budget/spec.md)：上下文预算、分页和对照实验的完整规格与证据
- [m1.2 History Compaction](docs/specs/m1.2-history-compaction/spec.md)：压缩策略、证据保留、回退与实验记录
- [模板](docs/templates/spec.md)：创建下一轮规格的起点

行为变更不能只用“功能已增加”作为完成标准，必须有需求 ID、验收标准、测试/Trace/评测证据和已知限制。

## 项目边界

这是一个**本地学习项目，不是生产级 Agent 平台**。

- `run_shell` 和 `run_python` 都不是安全沙箱
- 审批机制可以防止未确认执行，但不能阻止用户批准后的恶意代码
- 真正的恶意代码隔离需要容器、虚拟机或操作系统级权限控制，计划在后续阶段加入
- 当前不包含 Web UI、多 Agent、RAG、向量数据库和 MCP 接入

## 快速开始

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python3 main.py
```

默认使用本机 Ollama 的 OpenAI 兼容接口：

```bash
ollama serve
ollama pull glm-4.7-flash:latest
```

也可以在 `.env` 中设置：

```env
MODEL_PROVIDER=cloud
CLOUD_MODEL=deepseek-chat
CLOUD_API_KEY=your-key
```

或通过命令行覆盖：

```bash
python3 main.py --provider cloud --model deepseek-chat
```

## 工具

| 工具 | 作用 | 审批 |
|---|---|---|
| `ls` | 列出工作目录内容 | 否 |
| `read_file` | 在 observation 预算内读取文件，支持行号范围与续读 | 否 |
| `grep` | 在单个文件中做字面量搜索 | 否 |
| `find` | 按文件名递归查找 | 否 |
| `write_file` | 创建或覆盖文件 | 是 |
| `run_shell` | 以 argv 方式执行本地命令 | 是 |
| `run_python` | 在独立 Python 子进程中执行代码 | 是 |

交互模式下，写文件和执行工具会要求本地确认。`--auto-approve` 只应在临时目录或隔离环境中使用。

```bash
python3 main.py --workspace /path/to/sandbox --auto-approve
```

## 测试

确定性 Harness 测试不调用模型：

```bash
python3 -m unittest discover -s tests -v
```

覆盖工具 Schema、工作目录越权、符号链接逃逸、参数回传、审批拒绝和最大步数等行为。

当前共有 54 个确定性测试，覆盖 Token usage 提取、Context Snapshot、上下文窗口配置、长文件分页、有界截断、M1/M1.2 fixture、group 指标、压缩触发、证据提取、tool-call 协议、模型摘要回退和摘要成本分账。

## 运行评测

评测任务会把每个任务放进独立临时目录，并自动批准工具调用：

```bash
# 先跑一个原基线任务做连通性检查
python3 scripts/run_eval.py --limit 1

# 运行全部 10 个原基线任务
python3 scripts/run_eval.py

# 运行 5 个 M1.1 上下文任务
python3 scripts/run_eval.py --tasks evals/m1_tasks.json

# 运行 6 个 M1.2 历史压缩任务（以 extractive 为例）
export NO_PROXY=127.0.0.1,localhost
export no_proxy=127.0.0.1,localhost
python3 scripts/run_eval.py \
  --tasks evals/m1_2_tasks.json \
  --context-window-tokens 32768 \
  --compaction-strategy extractive \
  --compaction-trigger-tokens 800 \
  --compaction-keep-recent-messages 2 \
  --compaction-max-summary-chars 1600 \
  --output evals/results/m1_2-extractive-manual.json
```

M1.2 默认策略是 `off`。`extractive` 与 `model` 是实验开关，不是已验证的生产默认值。运行器在任务失败时返回非零退出码，但只要报告已生成，就应保留失败记录。完整条件、三策略结果、失败样本和限制见 [M1_2_COMPACTION_BASELINE.md](docs/M1_2_COMPACTION_BASELINE.md)。

结果写入 `evals/results/`。核心指标包括：

- 任务成功率
- 平均模型轮次
- 每任务输入 / 输出 / 总 Token
- 每轮上下文字符与峰值
- 峰值工具 observation 字符
- 主模型与摘要模型的输入 / 输出 / 总 Token
- 压缩次数、回退次数、压缩前后字符和峰值 prompt Token
- `scan`、`grep_first`、`multi_file`、`retention`、`failure`、`todo`、`rolling` group 汇总
- 工具错误次数
- 总耗时
- 每个检查项的通过情况
- 完整事件轨迹

固定任务定义在 `evals/tasks.json`、`evals/m1_tasks.json` 和 `evals/m1_2_tasks.json`。任务数量不是重点，重点是同一组任务能在修改 Prompt、模型、上下文策略或工具后重复比较。

## 运行轨迹

每次 CLI 会话会写入：

```text
traces/session-YYYYMMDD-HHMMSS.jsonl
```

主要事件包括：

```text
run_started
model_request
model_response
tool_call
tool_result
approval_denied
invalid_tool_arguments
model_error
history_compaction
compaction_model_request
compaction_model_response
compaction_model_error
run_finished
```

Trace 用于复盘 Agent 的真实行为，不依赖模型最后一段自我描述。

## 目录结构

```text
main.py                       CLI 入口
agent/
  approval.py                 人工审批策略
  compaction.py               历史压缩、证据提取与回退
  config.py                   环境与模型配置
  context.py                  上下文与 observation 快照
  loop.py                     Function Calling Agent Loop
  models.py                   核心数据结构
  prompts.py                  System Prompt
  trace.py                    JSONL 事件记录
providers/
  openai_compat.py            OpenAI 兼容模型适配
tools/
  builtin.py                  七个内置工具与工作目录边界
  spec.py                     工具契约、参数校验和注册表
evals/
  tasks.json                  10 个固定评测任务
  m1_tasks.json               5 个 M1.1 上下文任务
  m1_2_tasks.json             6 个 M1.2 历史压缩任务
scripts/
  run_eval.py                 评测执行器
tests/                        不依赖模型的确定性测试
docs/
  CONSTITUTION.md             长期工程原则与质量门禁
  SDD.md                      规范驱动开发工作流
  BASELINE.md                 v0.2.1 基线实验结果与边界
  M1_CONTEXT_BASELINE.md      M1.1 上下文实验与边界
  M1_2_COMPACTION_BASELINE.md M1.2 历史压缩实验与边界
  ROADMAP.md                  Agent 学习与能力路线
  specs/
    README.md                 规格目录约定
    v0.2.1-harness-baseline/
      spec.md                 需求与验收
      plan.md                 技术方案
      tasks.md                可执行任务账本
      implement.md            实施、证据与偏差
    m1.1-context-budget/
      spec.md                 Token、上下文与分页规格
      plan.md                 最小可观测方案
      tasks.md                实验任务账本
      implement.md            真实评测与实施记录
    m1.2-history-compaction/
      spec.md                 压缩策略、证据与回退规格
      plan.md                 最小可回退方案
      tasks.md                实验任务账本
      implement.md            三策略评测与实施记录
  templates/                  后续规格模板
  decisions/                  ADR 技术决策
```

## 下一步

M1.2 已完成历史压缩机制、三策略评测和负面结果记录。当前证据显示压缩能降低成本，但**没有稳定提高任务成功率的证据**，因此默认保持 `off`。

1. 可选：为压缩证据时序、重复压缩和多次重复实验单独开下一份规格
2. M2：`apply_patch`、修改后自动测试和验证修复闭环
3. M3：工具错误分类与可恢复性实验
4. M4：容器化执行边界

完整路线见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## License

MIT
