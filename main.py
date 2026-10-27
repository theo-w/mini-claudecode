import subprocess
from pathlib import Path
import os
import warnings
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
warnings.filterwarnings("ignore")

api_key = os.getenv("DEEPSEEK_API_KEY")
if not api_key:
    raise RuntimeError("请在 .env 配置 DEEPSEEK_API_KEY")

client = OpenAI(
    api_key=api_key,
    base_url="https://api.deepseek.com"
)
MODEL = "deepseek-flash"

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "ls",
            "description": "列出指定目录下的文件和子文件夹，传入相对路径",
            "parameters": {
                "type": "object",
                "properties": {
                    "dir_path": {
                        "type": "string",
                        "description": "目标目录，一般传入 . 代表当前目录"
                    }
                },
                "required": ["dir_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取本地文本文件全部内容，用于查看源码",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "文件相对路径"
                    }
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "写入/覆盖文本文件。谨慎使用，会覆盖原有内容",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "文件相对路径"
                    },
                    "content": {
                        "type": "string",
                        "description": "要写入的文本内容"
                    }
                },
                "required": ["file_path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "grep",
            "description": "在文件内搜索匹配文本，类似grep",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "目标文件路径"
                    },
                    "pattern": {
                        "type": "string",
                        "description": "搜索关键词/正则"
                    }
                },
                "required": ["file_path", "pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find",
            "description": "递归查找文件，按名称关键词搜索",
            "parameters": {
                "type": "object",
                "properties": {
                    "root": {
                        "type": "string",
                        "description": "搜索根目录，一般填 ."
                    },
                    "name_pattern": {
                        "type": "string",
                        "description": "文件名匹配关键词"
                    }
                },
                "required": ["root", "name_pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_shell",
            "description": "执行shell命令，返回stdout+stderr。风险高，仅限用户明确要求时调用",
            "parameters": {
                "type": "object",
                "properties": {
                    "cmd": {
                        "type": "string",
                        "description": "shell命令"
                    }
                },
                "required": ["cmd"]
            }
        }
    }
]


def ls(dir_path: str) -> str:
    try:
        p = Path(dir_path)
        entries = list(p.iterdir())
        lines = []
        for entry in entries:
            tag = "[DIR]" if entry.is_dir() else "[FILE]"
            lines.append(f"{tag} {entry.name}")
        return "\n".join(lines) if lines else "目录为空"
    except Exception as e:
        return f"[ls error] {str(e)}"


def read_file(file_path: str) -> str:
    try:
        p = Path(file_path)
        return p.read_text(encoding="utf-8")
    except Exception as e:
        return f"[read error] {str(e)}"


def write_file(file_path: str, content: str) -> str:
    try:
        p = Path(file_path)
        p.write_text(content, encoding="utf-8")
        return f"✅ 写入成功：{file_path}"
    except Exception as e:
        return f"[write error] {str(e)}"


def grep(file_path: str, pattern: str) -> str:
    try:
        p = Path(file_path)
        lines = p.read_text(encoding="utf-8").splitlines()
        out = []
        for idx, line in enumerate(lines, start=1):
            if pattern in line:
                out.append(f"{idx}: {line}")
        return "\n".join(out) if out else "没有匹配结果"
    except Exception as e:
        return f"[grep error] {str(e)}"


def find(root: str, name_pattern: str) -> str:
    res = []
    try:
        for fp in Path(root).rglob(f"*{name_pattern}*"):
            res.append(str(fp))
        return "\n".join(res) if res else "没有找到文件"
    except Exception as e:
        return f"[find error] {str(e)}"


def run_shell(cmd: str) -> str:
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            cwd=Path.cwd(),
            capture_output=True,
            text=True,
            timeout=10
        )
        return f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    except subprocess.TimeoutExpired:
        return "[shell error] 命令超时"
    except Exception as e:
        return f"[shell error] {str(e)}"


def dispatch_tool(name: str, args: dict):
    if name == "ls":
        return ls(args["dir_path"])
    elif name == "read_file":
        return read_file(args["file_path"])
    elif name == "write_file":
        return write_file(args["file_path"], args["content"])
    elif name == "grep":
        return grep(args["file_path"], args["pattern"])
    elif name == "find":
        return find(args["root"], args["name_pattern"])
    elif name == "run_shell":
        return run_shell(args["cmd"])
    return f"unknown tool {name}"


def run_agent_loop(messages: list, max_round=8):
    for _ in range(max_round):
        resp = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto"
        )
        msg = resp.choices[0].message
        if not msg.tool_calls:
            print(f"\n🤖 Agent：\n{msg.content}\n")
            messages.append(msg)
            return

        messages.append(msg)
        for tc in msg.tool_calls:
            tool_name = tc.function.name
            tool_args = json.loads(tc.function.arguments)
            print(f"🔧 调用工具：{tool_name}, 参数={tool_args}")
            obs = dispatch_tool(tool_name, tool_args)
            print(f"📄 Observation:\n{obs}\n")
            tool_msg = {
                "role": "tool",
                "tool_call_id": tc.id,
                "content": obs
            }
            messages.append(tool_msg)
    print("⚠️ 达到最大轮次限制\n")


if __name__ == "__main__":
    system_prompt = {
        "role": "system",
        "content": """
你是本地代码助手。严格遵守规则：
1. 用户明确要求读取某个文件，才调用 read_file；
2. 用户只输入 ls .，只列出目录，不要主动读取目录里所有文件；
3. write_file 覆盖风险高，必须确认用户意图；
4. run_shell 风险很高，**只有用户明确要求执行命令时才调用**；
5. 完成用户当前请求后，停止工具调用，直接输出回答。
"""
    }
    conversation_msgs = [system_prompt]
    print("===== Mini-ClaudeCode (DeepSeek ReAct Agent) =====")
    print("支持工具：ls, read_file, write_file, grep, find, run_shell")
    print("clear 清空上下文 | exit 退出\n")
    while True:
        user_input = input("📝 任务 > ").strip()
        if user_input.lower() in ["exit", "quit"]:
            print("👋 退出")
            break
        if user_input.lower() == "clear":
            conversation_msgs = [system_prompt]
            print("🧹 上下文已清空\n")
            continue
        if not user_input:
            continue
        conversation_msgs.append({"role": "user", "content": user_input})
        run_agent_loop(conversation_msgs)
