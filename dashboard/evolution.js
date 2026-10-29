"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AgentEvolution = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const COURSE_META = {
    id: "agent-evolution-lab",
    title: "从零建造一个 Agent",
    eyebrow: "BUILD FROM ZERO",
    promise: "每次只加一个零件。先看旧版本撞墙，再看补丁解决了什么。",
    disclaimer: "确定性教学快照 · 只读 · 不执行代码或工具",
  };

  const CHAPTERS = [
    {
      id: "model-only",
      number: 1,
      kicker: "起点 · 只有模型",
      title: "模型只会回答，不会替你行动",
      routeLabel: "Model",
      promise: "先接受一个限制：没有工具和执行器时，模型只能根据已有上下文生成文字。",
      pain: {
        title: "任务：读取 calc.py，然后运行测试",
        body: "模型不能读取本地文件，也不能执行测试或运行进程。它不知道磁盘上有什么，只能猜、建议你去做，或者要求你把内容贴进对话。",
        signal: "文字建议 ≠ 文件读取 ≠ 测试执行",
      },
      change: {
        title: "这一章不增加 Agent 零件",
        file: "model_only.py",
        code: `response = client.messages.create(
    model=MODEL,
    max_tokens=512,
    messages=[{"role": "user", "content": task}],
)

print(response.content[0].text)`,
        takeaway: "先记住：模型负责“生成下一步”，不会自动产生现实世界的副作用。",
      },
      run: {
        title: "确定性教学快照",
        lines: [
          'assistant> 我看不到本地文件。请把 calc.py 的内容贴出来，',
          'assistant> 或由你运行测试后把报错发给我。',
          "",
          "harness> 没有文件被读取，也没有测试被执行。",
        ],
        note: "这不是模型能力不足，而是它此刻没有可调用的工具。",
      },
      why: "很多“Agent”演示从一开始就同时展示工具、循环和提示词，容易让人误以为模型自己会执行。把模型单独拿出来，才能看清 Harness 后来补上的究竟是什么。",
      boundary: "更多 Prompt 不能突破这个边界。Prompt 可以要求模型“去读文件”，但不能凭空提供执行能力。",
      quiz: {
        question: "当前版本要实现“读取真实文件”，最小缺的是什么？",
        options: [
          { text: "一个更长的 System Prompt", correct: false, feedback: "Prompt 能表达意图，但不能提供文件 I/O 能力。" },
          { text: "一个可被模型请求、由 Harness 执行的文件工具", correct: true, feedback: "正确。工具把“想读”变成受控的真实动作。" },
          { text: "更多聊天历史", correct: false, feedback: "历史增加上下文，不会产生执行能力。" },
        ],
      },
      nextStage: "first-tool",
    },
    {
      id: "first-tool",
      number: 2,
      kicker: "第 1 个零件 · Tool",
      title: "加一个工具，模型第一次能“做一件事”",
      routeLabel: "read_file Tool",
      promise: "这一章只给模型一个只读工具。工具不是模型的一部分，而是 Harness 暴露给模型的能力。",
      pain: {
        title: "上一章缺的是真实世界入口",
        body: "模型需要读取文件，但必须先由 Harness 告诉它：有哪些工具、参数长什么样、调用后谁会执行。",
        signal: "Tool Schema 是能力说明书，不是执行结果",
      },
      change: {
        title: "只增加一个只读工具",
        file: "tools.py · Tool 的最小契约",
        code: `# Tool Schema：告诉模型“可以请求什么”
TOOLS = [{
    "name": "read_file",
    "description": "读取工作区内的文件",
    "input_schema": {
        "type": "object",
        "properties": {"path": {"type": "string"}},
        "required": ["path"],
    },
}]

def read_file(path):
    return (WORKSPACE / path).read_text()`,
        takeaway: "模型现在可以返回结构化 tool_call，但真正执行仍然由 Harness 完成。",
      },
      run: {
        title: "工具执行的观察结果",
        lines: [
          'model> tool_call read_file {"path": "calc.py"}',
          "harness> executing registered handler…",
          "observation> def add(a, b): return a + b",
          "",
          "model> 文件读取成功，但我还没有拿到下一轮请求。",
        ],
        note: "工具已经执行，不代表结果已经进入模型的下一轮上下文。",
      },
      why: "工具解决“模型无法影响环境”的问题。但只有工具还不够：Harness 必须把执行结果送回模型，否则模型仍然不知道发生了什么。",
      boundary: "工具是原子能力，不是完整流程。一个 read_file 不负责决定何时读、读多少、读完后怎么改代码。",
      quiz: {
        question: "工具执行成功，是否等于模型已经知道执行结果？",
        options: [
          { text: "是，调用成功就够了", correct: false, feedback: "执行成功只产生 Observation。没有回写，模型看不到它。" },
          { text: "不是，Observation 还必须进入下一次模型请求", correct: true, feedback: "正确。工具结果只有写回消息历史，才会影响下一轮。" },
          { text: "取决于模型大小", correct: false, feedback: "协议闭环与模型大小无关。" },
        ],
      },
      nextStage: "tool-loop",
    },
    {
      id: "tool-loop",
      number: 3,
      kicker: "第 2 个零件 · Loop",
      title: "把 Observation 送回去，形成 Tool Loop",
      routeLabel: "Agent Loop",
      promise: "这一章增加循环和结果回写。Agent 的最小闭环现在是：模型请求 → 工具执行 → 结果写回 → 再问模型。",
      pain: {
        title: "上一章的工具结果只停在 Harness 里",
        body: "模型提出读取请求后，Harness 执行了，但对话就此结束。没有第二次模型请求，Observation 不会改变下一步。",
        signal: "工具可用 ≠ 结果可用",
      },
      change: {
        title: "只增加结果接力",
        file: "loop.py · 最小闭环",
        code: `messages.append({"role": "assistant", "content": response.content})

for tool_use in response.content:
    if tool_use.type != "tool_use":
        continue
    observation = registry[tool_use.name](tool_use.input)
    messages.append({
        "role": "user",
        "content": [{
            "type": "tool_result",
            "tool_use_id": tool_use.id,
            "content": observation,
        }],
    })

response = client.messages.create(
    model=MODEL, tools=TOOLS, messages=messages
)`,
        takeaway: "Loop 的核心不是“再调用一次模型”，而是把可观察结果作为下一轮输入。",
      },
      run: {
        title: "闭环后的行为变化",
        lines: [
          "S1  model> read_file calc.py",
          "    tool > 文件内容: def add(a, b): return a + b",
          "S2  model> run_python 测试 add(1, 2)",
          "    tool > 3",
          "S3  model> 加法函数测试通过",
        ],
        note: "模型第一次能够根据真实 Observation 决定下一步，而不是凭想象继续。",
      },
      why: "循环把一次调用变成多轮决策。每一轮都包含“模型提出动作”和“环境返回结果”两个部分，Agent 的能力开始来自这条反馈链。",
      boundary: "Loop 需要停止条件和预算。只要模型不断请求工具，循环就可能无限继续；模型不再请求工具也只表示停止，不表示任务成功。",
      quiz: {
        question: "Tool Loop 中，下一次模型请求最重要的新输入是什么？",
        options: [
          { text: "上一轮模型的隐藏思考", correct: false, feedback: "Trace 通常没有可靠的隐藏思考，不能把它当作可观察输入。" },
          { text: "工具执行后产生的 Observation", correct: true, feedback: "正确。Observation 让模型看到动作在环境中的结果。" },
          { text: "固定的重试次数", correct: false, feedback: "重试次数是控制参数，不是环境反馈。" },
        ],
      },
      nextStage: "tool-registry",
    },
    {
      id: "tool-registry",
      number: 4,
      kicker: "第 3 个零件 · Registry",
      title: "工具变多后，用 Registry 保持契约一致",
      routeLabel: "Tool Registry",
      promise: "这一章不增加“更聪明的 Agent”，而是解决工具增长带来的分发、Schema 和错误处理问题。",
      pain: {
        title: "每多一个工具，就多一层 if/elif",
        body: "read_file、grep、write_file、run_shell 都堆进分支后，Schema 名称、参数校验、handler 和错误结果很容易不同步。",
        signal: "工具增长带来维护成本，而不是自动带来能力",
      },
      change: {
        title: "用注册表统一名称、校验器和 handler",
        file: "registry.py · 结构示意",
        code: `registry = {
    "read_file": ToolSpec(
        schema=READ_SCHEMA,
        handler=read_file,
        validate=validate_read_args,
    ),
    "grep": ToolSpec(
        schema=GREP_SCHEMA,
        handler=grep,
        validate=validate_grep_args,
    ),
}

spec = registry[tool_use.name]
args = spec.validate(tool_use.input)
result = spec.handler(args)`,
        takeaway: "Registry 把“模型看到的 Schema”和“Harness 执行的 handler”放在同一份契约里。",
      },
      run: {
        title: "统一分发后的错误语义",
        lines: [
          'model> tool_call read_file {"path": "notes.txt"}',
          "registry> validate path: ok",
          "tool> observation: 12 lines",
          "registry> structured result: ok=true, call_id=call-07",
        ],
        note: "参数错误、未知工具和执行错误应成为可观察结果，而不是让进程崩溃。",
      },
      why: "当工具只有一个时，分发函数足够；当工具开始增长时，Registry 才能减少重复分支、统一校验和错误结构。它是规模问题的回应。",
      boundary: "Registry 不是权限系统。工具被注册不等于可以被任意执行；目录边界、风险等级和审批仍然需要单独设计。",
      quiz: {
        question: "引入 Tool Registry 最直接的原因是什么？",
        options: [
          { text: "让模型自动变聪明", correct: false, feedback: "Registry 不改变模型推理能力。" },
          { text: "统一工具契约、参数校验和执行分发", correct: true, feedback: "正确。它解决工具数量增长后的结构一致性问题。" },
          { text: "绕过工具审批", correct: false, feedback: "Registry 不应绕过审批，反而应携带风险和执行策略。" },
        ],
      },
      nextStage: "safety-boundary",
    },
    {
      id: "safety-boundary",
      number: 5,
      kicker: "第 4 个零件 · Guardrail",
      title: "黑名单不是安全边界，审批也不是 Sandbox",
      routeLabel: "Workspace + Approval",
      promise: "这一章把“模型应该遵守”升级成“Harness 强制执行”，同时明确它仍然不是完整的恶意代码隔离。",
      pain: {
        title: "关键词过滤看起来安全，实际挡不住执行面",
        body: "对命令字符串做危险词检查，既可能误伤正常任务，也可能被其他写法绕过。路径没有工作区限制时，只读工具也能越界。",
        signal: "字符串黑名单不是安全边界",
      },
      change: {
        title: "先做三层最小防线",
        file: "guardrail.py · 结构示意",
        code: `workspace = Path(workspace_root).resolve()

def resolve_in_workspace(relative_path):
    target = (workspace / relative_path).resolve()
    if workspace not in target.parents:
        raise ValueError("path escapes workspace")
    return target

# 执行型工具：参数化 argv，不拼接 shell；执行前必须审批。
result = subprocess.run(
    argv,
    shell=False,
    cwd=workspace,
    capture_output=True,
    timeout=15,
)

if requires_approval(tool_spec) and not approver.confirm(tool_call):
    return approval_denied(tool_call)`,
        takeaway: "目录边界、参数化执行、审批和超时是不同层次的边界，不能互相替代。",
      },
      run: {
        title: "边界发生在工具执行前",
        lines: [
          "request > write_file ../outside.txt",
          "guardrail> path escapes workspace",
          "observation> rejected before handler",
          "",
          "request > run_shell …",
          "approval> waiting for explicit user confirmation",
        ],
        note: "拒绝发生在执行前，才叫 Guardrail；执行后靠模型自我反省，不算安全保证。",
      },
      why: "当工具从只读扩展到写入和执行，错误不再只是答错，而可能造成真实副作用。因此安全边界必须由 Harness 强制执行，而不是交给模型自觉。",
      boundary: "审批是策略闸门，不等同于隔离。即使工具通过参数校验和人工批准，执行任意代码仍可能逃逸；真正隔离需要容器、虚拟机或操作系统级权限控制。",
      quiz: {
        question: "用户批准了 run_shell，这是否等于已经拥有 Sandbox 隔离？",
        options: [
          { text: "是，审批就是 Sandbox", correct: false, feedback: "审批只决定“是否放行”，不限制被放行代码能访问什么。" },
          { text: "不是，审批与隔离解决的是不同问题", correct: true, feedback: "正确。审批是策略闸门，隔离是运行时边界。" },
          { text: "只要设置了超时就是 Sandbox", correct: false, feedback: "超时只限制时间，不限制文件、网络和进程权限。" },
        ],
      },
      nextStage: "trace",
    },
    {
      id: "trace",
      number: 6,
      kicker: "第 5 个零件 · Trace",
      title: "没有 Trace，就无法解释哪一步出了错",
      routeLabel: "Trace",
      promise: "这一章让运行过程留下结构化证据。Trace 不替 Agent 做决定，只记录可观察事件。",
      pain: {
        title: "最终回答只有一句“已完成”",
        body: "任务失败后，如果只保存最终文本，就无法知道工具是否执行、Observation 是否写回、Loop 在哪一轮停止，也无法复现争议。",
        signal: "最终答案不足以解释执行过程",
      },
      change: {
        title: "给每次关键事件留下同一份轨迹",
        file: "trace.py · JSONL 事件",
        code: `def record(event, **fields):
    trace.write(json.dumps({
        "event": event,
        "call_id": fields.get("call_id"),
        "step": fields.get("step"),
        "sequence": next_sequence(),
        **fields,
    }) + "\\n")

record("model_response", step=1, tool_calls=response.tool_calls)
record("tool_call", step=1, call_id=call.id, name=call.name)
record("tool_result", step=1, call_id=call.id, ok=True, content=obs)`,
        takeaway: "用稳定的 call_id 和 sequence 把模型请求、工具执行和结果写回串起来。",
      },
      run: {
        title: "可回放的事件轨迹",
        lines: [
          "001 model_request  step=1",
          "002 model_response step=1 tool_calls=[call-07]",
          "003 tool_call      step=1 call_id=call-07 read_file",
          "004 tool_result    step=1 call_id=call-07 ok=true",
          "005 model_response step=2 tool_calls=[]",
          "006 run_finished   status=completed",
        ],
        note: "结构证据能证明“发生了什么”，但不能自动证明模型的内部动机。",
      },
      why: "Trace 把一次模糊的运行变成可检查的证据链。它让 Story、Loop 回放、错误定位和后续 Eval 都有同一个事实来源。",
      boundary: "Trace 只能证明被记录的可观察行为。字段接力可以说明“Observation 出现了，下一步没有继续调用工具”，不能补写成“模型心里认为已经完成”。",
      quiz: {
        question: "Trace 中出现 tool_result，能够直接证明什么？",
        options: [
          { text: "任务一定完成", correct: false, feedback: "工具执行与任务交付是两件事。" },
          { text: "工具结果在对应 call_id 上被记录并可供回放", correct: true, feedback: "正确。这是结构证据，不自动推出最终验收。" },
          { text: "模型一定理解了结果", correct: false, feedback: "结果写回与模型如何理解是不同问题。" },
        ],
      },
      nextStage: "eval",
    },
    {
      id: "eval",
      number: 7,
      kicker: "第 6 个零件 · Eval",
      title: "最后一步：用 Eval 判断任务是否真的交付",
      routeLabel: "Eval",
      promise: "这一章把“看起来运行完了”变成可比较的结果。Trace 记录过程，Eval 按任务契约回答问题。",
      pain: {
        title: "Agent 说完成了，但答案少了关键结果",
        body: "能力检查可以通过，因为工具确实执行；Loop 也可以正常停止。但只要最终答案没有满足验收条件，任务仍然是失败。",
        signal: "工具 PASS ≠ 任务 PASS",
      },
      change: {
        title: "把最终验收、过程、能力、完整性分开",
        file: "checks.py · 结果结构",
        code: `checks = [
    check_final_acceptance(task, final_text),
    check_process_constraints(trace, task),
    check_capability_evidence(trace, task),
    check_experiment_integrity(trace, task),
]

overall = "PASS" if all_final_acceptance_pass(checks) else "FAIL"

# SKIP 只表示没有验证条件，不能算通过。
assert overall != "PASS" or all(
    check.status == "PASS" for check in checks
)`,
        takeaway: "整体结果由最终验收决定；过程、能力和完整性检查负责解释原因与限制。",
      },
      run: {
        title: "默认失败样本的四类结果",
        lines: [
          "最终验收     FAIL  0/3  关键结果没有交付",
          "过程约束     PASS  1/1  没有使用禁止路径",
          "能力证据     PASS  2/2  工具确实执行过",
          "实验完整性   SKIP  1/1  SKIP != PASS",
          "",
          "overall> FAIL",
        ],
        note: "能力 PASS 只说明工具执行了，不说明任务交付了。",
      },
      why: "如果没有固定验收，Prompt、模型或工具改动只能靠感觉比较。Eval 让差异变成可重复的问题：哪个任务变了、哪个 check 分叉、是结果变化还是只是成本变化。",
      boundary: "单次 Eval 是快照，不是稳定成功率。一次 A/B 差异只能提供线索，不能自动证明某个参数造成了全部结果差异。",
      quiz: {
        question: "能力证据 PASS，但最终验收 FAIL，最合理的解释是什么？",
        options: [
          { text: "数据互相矛盾，应该忽略最终验收", correct: false, feedback: "两者回答不同问题，不矛盾。" },
          { text: "工具执行过，但最终答案没有满足任务契约", correct: true, feedback: "正确。流程有动作，不等于交付有结果。" },
          { text: "只要工具 PASS，整体就应该 PASS", correct: false, feedback: "工具能力只是检查之一，不能替代最终交付。" },
        ],
      },
      nextStage: "skill",
    },
  ];

  const TOOL_VS_SKILL = {
    tool: {
      label: "Tool",
      definition: "一种可执行能力：模型提出结构化请求，Harness 执行并返回 Observation。",
      example: "read_file、grep、write_file、run_shell",
    },
    skill: {
      label: "Skill",
      definition: "一种可复用的流程知识：告诉 Agent 某类任务应如何组织步骤、资源和工具。",
      example: "“修复测试”流程：定位测试 → 运行 → 修改 → 再运行",
    },
    relation: "Skill 可以使用 Tool，但不会替代 Tool 的权限、执行和审计边界。",
  };

  const ROADMAP = [
    {
      id: "skill",
      phase: "later",
      title: "Skill",
      after: ["first-tool", "tool-loop", "trace", "eval"],
      trigger: "同一类任务反复出现，流程本身值得版本化，且已经能通过 Eval 判断是否变好。",
      cost: "需要设计发现、加载、版本、依赖和执行审批，不能只新增一个文件夹就宣称能力提升。",
    },
    {
      id: "mcp",
      phase: "later",
      title: "MCP",
      after: ["tool-registry", "safety-boundary"],
      trigger: "工具来自外部服务，需要跨客户端复用协议和生命周期时。",
      cost: "增加进程、认证、网络、错误语义和部署边界。",
    },
    {
      id: "rag",
      phase: "later",
      title: "RAG",
      after: ["tool-registry", "trace", "eval"],
      trigger: "知识无法稳定放进上下文，需要检索、权限控制和新鲜度管理时。",
      cost: "检索质量、索引更新、引用和召回误差会引入新的失败模式。",
    },
    {
      id: "memory",
      phase: "later",
      title: "Memory",
      after: ["trace", "eval"],
      trigger: "需要跨会话保留偏好或历史，并且能验证记忆是否准确时。",
      cost: "会产生隐私、过期、冲突和错误固化问题。",
    },
    {
      id: "subagent",
      phase: "later",
      title: "Subagent",
      after: ["trace", "eval"],
      trigger: "任务可以独立拆分，需要上下文隔离或并行工作流时。",
      cost: "协调、上下文传递、合并冲突和整体评测成本都会上升。",
    },
  ];

  const OUTCOMES = [
    "模型只负责生成下一步，Harness 负责执行和边界。",
    "工具给模型行动能力，Observation 把行动结果送回模型。",
    "Loop 必须有停止条件和预算；停止不等于任务成功。",
    "Trace 记录可观察行为，Eval 判断任务是否交付。",
    "Skill 是流程知识，不是 Tool 的升级版；先有 Eval 才能判断它是否值得加入。",
  ];

  function chapterAt(index) {
    const numeric = Number(index);
    const normalized = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
    return CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, normalized))] || CHAPTERS[0];
  }

  function chapterById(id) {
    return CHAPTERS.find((chapter) => chapter.id === id) || null;
  }

  function correctOption(chapter) {
    return chapter?.quiz?.options?.find((option) => option.correct) || null;
  }

  function progressLabel(index) {
    const chapter = chapterAt(index);
    return `第 ${chapter.number} / ${CHAPTERS.length} 章 · ${chapter.kicker}`;
  }

  return {
    COURSE_META,
    CHAPTERS,
    TOOL_VS_SKILL,
    ROADMAP,
    OUTCOMES,
    chapterAt,
    chapterById,
    correctOption,
    progressLabel,
  };
});
