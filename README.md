# Mini-ClaudeCode

轻量本地 ReAct 代码 Agent，对标 ClaudeCode / Cursor Agent，手写原生工具循环，不重度依赖 Agent 框架。
适合学习 Function Calling、ReAct、MCP；同时支持云端 API / 本地 OpenAI 兼容模型（Ollama / MLX / SGLang）

> 
> 项目定位：学习向、可演进的最小编码 Agent 底座，后续扩展游戏日志分析能力（结合游戏行业背景）

## ✨ 特性

- 原生手写 ReAct 工具调用循环，消息流严格对齐 function calling 协议
- 一键切换：云端 DeepSeek / 本地 Ollama/MLX 等兼容 OpenAI 接口的模型
- 内置工具：ls /read_file/write_file /grep/find /run_shell
- 工具注册表模式，新增工具只需要注册一行，避免大量 if-elif
- 容错：工具参数 JSON 解析失败捕获、错误回传给模型自修正
- shell 安全黑名单、输出截断、调用重试
- MCP 接入，把文件能力迁移到 MCP Server
- 远期：游戏日志 / 玩家舆情分析 Skill，行业差异化扩展
- - 内置安全沙箱（学习向）
  - shell 命令黑名单拦截
  - AST静态扫描Python代码，拦截subprocess/os等高风险模块
  - 字面量 open / Path 路径校验，仅允许在当前工作目录读写文件
  - 所有文件工具统一路径越权检查
- 新增 run_python 工具，模型必须通过工具调用执行Python脚本


## ⚠️ 风险提示

run_shell 可以执行本机命令，**本沙箱仅为学习演示，存在动态字符串拼接绕过的可能性，不可直接用于生产环境**。

## 📦 环境依赖

```
pip install openai python-dotenv
```

## 🚀 启动方式

1. 复制 `.env.example` 为 `.env`，填写 API KEY（本地 Ollama 可以随便填 dummy）
2. 修改代码头部 `USE_LOCAL` 开关，切换云端 / 本地后端
3. 启动

```
python3 main.py
```

## 🧰 内置工具说明

- `ls(dir_path)`：列出目录
- `read_file(file_path)`：读取文本文件
- `write_file(file_path, content)`：覆盖写入文件
- `grep(file_path, pattern)`：文件内关键词检索
- `find(root, name_pattern)`：递归查找文件名
- `run_shell(cmd)`：执行 shell 命令（带黑名单防护）

## 📅 迭代计划（Roadmap）

- v0.1：基础 ReAct 循环、基础工具集、云端 / 本地模型切换、JSON 解析容错
- v0.2：新增 shell 黑名单、返回内容截断、工具重试逻辑
- v0.3：接入 MCP，文件操作交给 MCP Server，解耦工具
- v0.4：增加对话持久化、简单 Web 交互界面
- v0.5：游戏日志解析、玩家舆情分析专项 Agent 能力

## 📚 学习笔记（面试口述要点）

1. 本地开源模型（Qwen/GLM）的 Function Calling 稳定性弱于云端模型，经常输出格式错误的 JSON，所以代码里必须增加 JSON 解析容错，把错误信息回传给模型让它修正。
2. tool_calls 和 tool 消息必须严格一一配对、ID 对应，否则 OpenAI 兼容 API 会直接返回 400 报错，这是前期踩的核心协议坑。
3. 原生 tools、Skill、MCP 三者定位不一样：tools 是 API 内联的 schema；skill 是打包了校验、重试的子流程；MCP 是跨进程独立工具服务协议。
4. 代码 Agent 安全边界重点两个风险点：shell 命令执行、文件覆盖写入；所以增加黑名单拦截、文件操作确认机制。
5. 工具返回内容必须做截断控制，不然单次返回大量文本会快速耗尽上下文窗口。

## License

MIT
