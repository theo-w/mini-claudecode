# Mini-ClaudeCode / Mini Agent Harness

一个用于系统学习 Agent 工程的最小代码 Agent Harness。项目目标不是再实现一个 Claude Code，而是把 Agent 的关键机制做成可运行、可观察、可评测的实验底座。

当前版本：**v0.2.1 Harness Baseline**。首轮可复现实验结果见 [docs/BASELINE.md](docs/BASELINE.md)。

## 现在能学到什么

- OpenAI 兼容的 Function Calling 消息协议
- 模型驱动循环、工具注册表与工具参数契约
- 文件搜索、读取、写入和执行型工具
- 工作目录边界与 Harness 层人工审批
- 结构化 JSONL 运行轨迹
- 固定任务评测、成功率、步数和工具错误统计
- 本地模型与云端模型切换

## SDD 规范驱动开发

项目使用 Spec-Driven Development 管理每次能力演进：

- [CONSTITUTION.md](docs/CONSTITUTION.md)：长期工程原则与不可妥协边界
- [SDD.md](docs/SDD.md)：Spec → Plan → Tasks → Implement → Verify 工作流
- [规格目录](docs/specs/README.md)：每个变更的完整文档集合
- [v0.2.1 完整示例](docs/specs/v0.2.1-harness-baseline/spec.md)：当前基线的 Spec、Plan、Tasks 和 Implement
- [模板](docs/templates/spec.md)：创建下一轮 M1 规格的起点

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
| `read_file` | 读取文件，支持行号范围 | 否 |
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

## 运行评测

评测任务会把每个任务放进独立临时目录，并自动批准工具调用：

```bash
# 先跑一个任务做连通性检查
python3 scripts/run_eval.py --limit 1

# 运行全部 10 个固定任务
python3 scripts/run_eval.py
```

结果写入 `evals/results/`。核心指标包括：

- 任务成功率
- 平均模型轮次
- 工具错误次数
- 总耗时
- 每个检查项的通过情况
- 完整事件轨迹

固定任务定义在 `evals/tasks.json`。任务数量不是重点，重点是同一组任务能在修改 Prompt、模型或工具后重复比较。

## 运行轨迹

每次 CLI 会话会写入：

```text
traces/session-YYYYMMDD-HHMMSS.jsonl
```

主要事件包括：

```text
run_started
model_response
tool_call
tool_result
approval_denied
invalid_tool_arguments
model_error
run_finished
```

Trace 用于复盘 Agent 的真实行为，不依赖模型最后一段自我描述。

## 目录结构

```text
main.py                       CLI 入口
agent/
  approval.py                 人工审批策略
  config.py                   环境与模型配置
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
scripts/
  run_eval.py                 评测执行器
tests/                        不依赖模型的确定性测试
docs/
  CONSTITUTION.md             长期工程原则与质量门禁
  SDD.md                      规范驱动开发工作流
  BASELINE.md                 v0.2.1 基线实验结果与边界
  ROADMAP.md                  Agent 学习与能力路线
  specs/
    README.md                 规格目录约定
    v0.2.1-harness-baseline/
      spec.md                 需求与验收
      plan.md                 技术方案
      tasks.md                可执行任务账本
      implement.md            实施、证据与偏差
  templates/                  后续规格模板
  decisions/                  ADR 技术决策
```

## 下一步

下一阶段不是接 MCP，而是按 [SDD 工作流](docs/SDD.md) 建立 M1 的上下文预算规格，再补验证闭环：

1. 长文件分页、Token 预算和上下文压缩
2. `apply_patch` 等更小粒度的修改能力
3. 修改后自动运行测试并进入修复循环
4. 工具错误分类与可恢复性实验
5. 容器化执行边界

完整路线见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## License

MIT
