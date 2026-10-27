import subprocess
from pathlib import Path
import os
import warnings
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
warnings.filterwarnings("ignore")

# ================= 配置区 =================
USE_LOCAL = True
MAX_OBSERVATION_LEN = 1500  # 工具返回截断上限
MAX_TOOL_RETRY = 2          # 工具调用出错最大重试次数
DEBUG = False                # 打开可以打印原始消息

if USE_LOCAL:
    BASE_URL = "http://127.0.0.1:11434/v1"
    API_KEY = "dummy"
    MODEL = "qwen2.5:7b-instruct"
else:
    BASE_URL = "https://api.deepseek.com"
    API_KEY = os.getenv("DEEPSEEK_API_KEY")
    MODEL = "deepseek-flash"

# shell 黑名单，包含高危操作
SHELL_BLACKLIST = {"rm", "sudo", "chmod", "chown", "dd", "> /", ">> /", "mkfs", "passwd"}
# ==========================================

client = OpenAI(
    api_key=API_KEY,
    base_url=BASE_URL
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "ls",
            "description": "列出指定目录下的文件和子文件夹，传入相对路径",
            "parameters": {
                "type": "object",
                "properties": {
                    "dir_path": {"type": "string", "description": "目标目录，一般传入 . 代表当前目录"}
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
                    "file_path": {"type": "string"}
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
                    "file_path": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["file_path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "grep",
            "description": "在文件内搜索匹配文本",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string"},
                    "pattern": {"type": "string"}
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
                    "root": {"type": "string"},
                    "name_pattern": {"type": "string"}
                },
                "required": ["root", "name_pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_shell",
            "description": "执行shell命令，仅限用户明确要求时调用，风险很高",
            "parameters": {
                "type": "object",
                "properties": {
                    "cmd": {"type": "string"}
                },
                "required": ["cmd"]
            }
        }
    }
]

# ========== Tool Implement ==========
def _truncate(text: str) -> str:
    if len(text) > MAX_OBSERVATION_LEN:
        return text[:MAX_OBSERVATION_LEN] + "\n... [内容截断，超出上限]"
    return text

def ls(dir_path: str) -> str:
    try:
        p = Path(dir_path)
        entries = list(p.iterdir())
        lines = []
        for entry in entries:
            tag = "[DIR]" if entry.is_dir() else "[FILE]"
            lines.append(f"{tag} {entry.name}")
        res = "\n".join(lines) if lines else "目录为空"
        return _truncate(res)
    except Exception as e:
        return f"[ls error] {str(e)}"

def read_file(file_path: str) -> str:
    try:
        p = Path(file_path)
        content = p.read_text(encoding="utf-8")
        return _truncate(content)
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
        res = "\n".join(out) if out else "没有匹配结果"
        return _truncate(res)
    except Exception as e:
        return f"[grep error] {str(e)}"

def find(root: str, name_pattern: str) -> str:
    res = []
    try:
        for fp in Path(root).rglob(f"*{name_pattern}*"):
            res.append(str(fp))
        ret = "\n".join(res) if res else "没有找到文件"
        return _truncate(ret)
    except Exception as e:
        return f"[find error] {str(e)}"

def run_shell(cmd: str) -> str:
    # 高危命令拦截
    cmd_lower = cmd.lower()
    for bad in SHELL_BLACKLIST:
        if bad in cmd_lower:
            return f"[shell reject] 禁止高危命令，命中黑名单关键词：{bad}"
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            cwd=Path.cwd(),
            capture_output=True,
            text=True,
            timeout=10
        )
        full = f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        return _truncate(full)
    except subprocess.TimeoutExpired:
        return "[shell error] 命令超时"
    except Exception as e:
        return f"[shell error] {str(e)}"

TOOL_REGISTRY = {
    "ls": ls,
    "read_file": read_file,
    "write_file": write_file,
    "grep": grep,
    "find": find,
    "run_shell": run_shell
}

def dispatch_tool(name: str, args: dict):
    if name not in TOOL_REGISTRY:
        return f"unknown tool {name}"
    func = TOOL_REGISTRY[name]
    # 带重试
    err = None
    for attempt in range(MAX_TOOL_RETRY + 1):
        try:
            return func(**args)
        except Exception as e:
            err = e
            if attempt < MAX_TOOL_RETRY:
                if DEBUG:
                    print(f"工具调用重试 {attempt+1}/{MAX_TOOL_RETRY} err: {e}")
    return f"[tool failed after retry] {err}"


def run_agent_loop(messages: list, max_round=8):
    for _ in range(max_round):
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto"
            )
        except Exception as e:
            print(f"\n❌ API调用异常: {e}")
            return
        msg = resp.choices[0].message
        if DEBUG:
            print("\n==== MODEL RAW MSG ====")
            print(msg)
        if not msg.tool_calls:
            print(f"\n🤖 Agent：\n{msg.content}\n")
            messages.append(msg)
            return

        messages.append(msg)
        for tc in msg.tool_calls:
            try:
                tool_args = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                err_msg = f"❌ 参数JSON解析失败，原始参数：{tc.function.arguments}"
                print(err_msg)
                tool_msg = {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": err_msg
                }
                messages.append(tool_msg)
                continue
            tool_name = tc.function.name
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
4. run_shell 风险很高，只有用户明确要求执行命令时才调用；
5. 完成用户当前请求后，停止工具调用，直接输出回答。
6. 输出工具调用时，严格使用标准tool_call格式，不要自然语言描述调用。
"""
    }
    conversation_msgs = [system_prompt]
    print("===== Mini-ClaudeCode v0.2 =====")
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