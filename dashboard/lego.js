"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AgentLego = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TASK = {
    id: "repair-config",
    label: "SCRIPTED MISSION",
    title: "修复配置，并让测试真正通过",
    prompt: "读取 config.py，把 VERSION 从 1.2.0 改成 1.3.0，然后运行测试。",
    fixture: "config.py · 24 行 · VERSION = \"1.2.0\"",
    expected: "VERSION = \"1.3.0\"，测试 4/4 PASS",
    checks: [
      { id: "read", label: "读到当前配置", evidence: "read_file observation" },
      { id: "update", label: "写入目标版本", evidence: "write_file observation" },
      { id: "test", label: "运行测试并通过", evidence: "run_python observation" },
    ],
  };

  const COMPONENTS = [
    {
      id: "read_file",
      group: "action",
      type: "Tool",
      icon: "R",
      name: "读取文件",
      method: "read_file(file_path)",
      location: "Harness / ToolRegistry → workspace",
      definition: "把读取文件的意图变成受控的 workspace I/O，并返回 Observation。",
      enters: "模型第一次需要知道文件内容时。",
      missing: "模型看不到 config.py，只能描述步骤，无法产生第一次真实读取动作。",
      accent: "sky",
      order: 1,
    },
    {
      id: "write_file",
      group: "action",
      type: "Tool",
      icon: "W",
      name: "写入文件",
      method: "write_file(file_path, content)",
      location: "Harness / ToolRegistry → workspace",
      definition: "让模型能够修改工作区文件；写入属于有副作用的高风险动作。",
      enters: "Observation 表明需要修改，且已有写入工具时。",
      missing: "模型知道目标版本是 1.3.0，却没有能力修改文件，任务会停在读取之后。",
      accent: "coral",
      order: 2,
    },
    {
      id: "run_python",
      group: "action",
      type: "Tool",
      icon: "▶",
      name: "运行测试",
      method: "run_python(code)",
      location: "Harness / ToolRegistry → child process",
      definition: "执行测试脚本，把真实退出结果和输出带回 Agent。",
      enters: "文件修改后，需要验证交付而非相信模型声明时。",
      missing: "文件可能已经改动，但没有测试 Observation；模型说完成也不能替代测试通过。",
      accent: "sun",
      order: 3,
    },
    {
      id: "loop",
      group: "runtime",
      type: "Loop",
      icon: "∞",
      name: "Tool Loop",
      method: "model → tool → observation → model",
      location: "Agent runtime / between model and tools",
      definition: "把 tool_result 写回下一轮消息，让模型依据真实 Observation 继续决策。",
      enters: "每次工具调用之后；没有它，一次行动无法变成连续任务。",
      missing: "工具只能响一次；Observation 回不到模型，第二步决策不会发生。",
      accent: "mint",
      order: 4,
    },
    {
      id: "registry",
      group: "runtime",
      type: "Registry",
      icon: "{}",
      name: "Tool Registry",
      method: "registry.resolve(tool_name)",
      location: "Harness / tool contract boundary",
      definition: "统一工具 Schema、参数校验、handler 和错误结构，减少手写分发的不一致。",
      enters: "工具数量增长后；它不替模型变聪明，但让契约更稳定。",
      missing: "少量工具仍可能靠手写分发跑通，但 Schema、参数校验和错误结构会逐渐不一致。",
      accent: "sand",
      order: 5,
    },
    {
      id: "guardrail",
      group: "control",
      type: "Guardrail",
      icon: "!",
      name: "执行边界",
      method: "policy.check(tool, args)",
      location: "Harness / immediately before side effects",
      definition: "在写入或执行前检查 workspace 边界、风险与审批，不让 Prompt 成为唯一防线。",
      enters: "工具真正产生副作用之前。",
      missing: "工具仍可能执行，但写入前没有 Harness 统一边界；任务可以 PASS，执行边界却只能是 UNKNOWN。",
      accent: "rose",
      order: 6,
    },
    {
      id: "trace",
      group: "control",
      type: "Trace",
      icon: "E",
      name: "运行轨迹",
      method: "trace.append(event)",
      location: "Harness / evidence plane",
      definition: "记录模型请求、工具调用和 Observation，让系统可以事后复核发生了什么。",
      enters: "每次可观察动作发生时；它不改变任务结果，只改变可审计性。",
      missing: "任务仍可能 PASS，但只留下验收结论，没有可复核的模型与工具过程。",
      accent: "violet",
      order: 7,
    },
    {
      id: "eval",
      group: "control",
      type: "Eval",
      icon: "V",
      name: "任务验收",
      method: "eval.run(contract, evidence)",
      location: "Evaluation layer / after task run",
      definition: "按任务契约检查最终交付，不让“模型说完成了”自动等于任务通过。",
      enters: "运行结束后，需要形成 PASS / FAIL 结论时。",
      missing: "动作可能全部完成，但系统无法按契约判 PASS；结果只能停在 UNVERIFIED。",
      accent: "navy",
      order: 8,
    },
  ];

  const GROUPS = [
    { id: "action", label: "动作积木", hint: "Tool 决定 Agent 能对现实世界做什么。" },
    { id: "runtime", label: "回路积木", hint: "Loop 与 Registry 决定动作怎样连成任务。" },
    { id: "control", label: "系统积木", hint: "约束、证据与验收决定结果是否可信。" },
  ];

  const PRESETS = [
    { id: "model-only", label: "只有模型", detail: "先看没有动作能力会卡在哪里", selection: [] },
    {
      id: "one-tool",
      label: "只加读取",
      detail: "有工具但没有回路，Observation 回不去",
      selection: ["read_file"],
    },
    {
      id: "working",
      label: "能干活",
      detail: "三个工具 + Loop：动作可以完成",
      selection: ["read_file", "write_file", "run_python", "loop"],
    },
    {
      id: "trusted",
      label: "完整可信",
      detail: "再加 Registry、边界、Trace、Eval",
      selection: COMPONENTS.map((component) => component.id),
    },
  ];

  const COST_MODEL = {
    modelTurnMs: 720,
    toolCallMs: 180,
    guardrailPerToolMs: 45,
    registryPerToolMs: 25,
    traceFixedMs: 20,
    traceEventMs: 8,
    evalMs: 90,
  };

  const STATUS_RANK = { BLOCKED: 0, FAIL: 0, INCOMPLETE: 1, UNVERIFIED: 2, PASS: 3 };
  const SAFETY_RANK = { UNKNOWN: 0, READY: 1, PASS: 2 };
  const EVIDENCE_RANK = { NONE: 0, EVAL_ONLY: 1, TRACE_ONLY: 1, FULL: 2 };

  function componentById(id) {
    return COMPONENTS.find((component) => component.id === id) || null;
  }

  function normalizeSelection(selection) {
    const selected = selection instanceof Set ? new Set(selection) : new Set(Array.isArray(selection) ? selection : []);
    return COMPONENTS.filter((component) => selected.has(component.id)).map((component) => component.id);
  }

  function selectedComponents(selection) {
    const ids = new Set(normalizeSelection(selection));
    return COMPONENTS.filter((component) => ids.has(component.id));
  }

  function formatSeconds(ms) {
    return `${(Number(ms) / 1000).toFixed(2)}s`;
  }

  function signed(value, suffix = "") {
    if (value === 0) return "不变";
    return `${value > 0 ? "+" : ""}${value}${suffix}`;
  }

  function statusCopy(status) {
    return {
      BLOCKED: { label: "卡住", detail: "第一个动作没有发生", tone: "bad" },
      INCOMPLETE: { label: "未完成", detail: "动作发生了，但没有交付", tone: "warn" },
      UNVERIFIED: { label: "待验收", detail: "动作完成，但没有验收证据", tone: "warn" },
      PASS: { label: "通过", detail: "交付与验收检查都通过", tone: "good" },
      FAIL: { label: "未通过", detail: "验收发现了未满足项", tone: "bad" },
    }[status];
  }

  function simulateRun(selection) {
    const ids = new Set(normalizeSelection(selection));
    const hasRead = ids.has("read_file");
    const hasWrite = ids.has("write_file");
    const hasRun = ids.has("run_python");
    const hasLoop = ids.has("loop");
    const hasRegistry = ids.has("registry");
    const hasGuardrail = ids.has("guardrail");
    const hasTrace = ids.has("trace");
    const hasEval = ids.has("eval");

    const events = [];
    let modelTurns = 1;
    let toolCalls = 0;
    let activeTool = null;

    function push(kind, title, detail, actors, status = "") {
      events.push({
        sequence: events.length + 1,
        kind,
        title,
        detail,
        actors: [...actors],
        status,
      });
    }

    function invokeTool(componentId, title, observation, actors) {
      activeTool = componentId;
      const tool = componentById(componentId);
      if (hasGuardrail) {
        push(
          "guardrail",
          `边界检查 · ${tool.method}`,
          "workspace 路径在允许范围内；有副作用的动作进入审批闸门。",
          ["guardrail"],
          "PASS",
        );
      }
      if (hasRegistry) {
        push(
          "registry",
          `Registry 解析 · ${tool.name}`,
          "Schema、参数校验和 handler 来自同一份工具契约。",
          ["registry"],
          "PASS",
        );
      }
      push("tool", `调用 ${tool.method}`, title, [componentId], "PASS");
      toolCalls += 1;
      push("observation", "Observation 返回", observation, [componentId], "PASS");
    }

    push("task", "模型收到固定任务", TASK.prompt, [], "READY");

    if (!hasRead) {
      push(
        "model",
        "模型只能给建议",
        "没有 read_file，模型无法看到 config.py。它可以描述步骤，但不能产生真实读取动作。",
        ["model"],
        "BLOCKED",
      );
    } else {
      push(
        "model",
        "第 1 轮 · 模型决定读取",
        "模型请求 read_file，因为要先知道当前 VERSION。",
        ["model", "read_file"],
        "READY",
      );
      invokeTool(
        "read_file",
        "read_file(file_path=\"config.py\") → VERSION = \"1.2.0\"",
        "文件已读取，目标版本 1.3.0 与当前值 1.2.0 不同。",
        ["read_file"],
      );

      if (!hasLoop) {
        push(
          "system",
          "Loop 未装配，回路在此断开",
          "Observation 已经产生，但没有 tool_result → 下一轮模型的连接。工具完成了动作，Agent 没有把它变成连续任务。",
          ["loop"],
          "BLOCKED",
        );
      } else {
        modelTurns += 1;
        if (!hasWrite) {
          push(
            "model",
            "第 2 轮 · 模型知道要改，但没有写工具",
            "模型看到了 1.2.0，也提出了 1.3.0，却没有 write_file 可以真正修改文件。",
            ["model", "loop", "write_file"],
            "BLOCKED",
          );
        } else {
          push(
            "model",
            "第 2 轮 · 模型决定写入",
            "Observation 中包含当前版本，模型请求 write_file 写入目标版本。",
            ["model", "loop", "write_file"],
            "READY",
          );
          invokeTool(
            "write_file",
            "write_file(file_path=\"config.py\", VERSION=\"1.3.0\") → saved",
            "文件写入成功。现在文件看起来已修改，但还没有运行测试。",
            ["write_file"],
          );

          modelTurns += 1;
          if (!hasRun) {
            push(
              "model",
              "第 3 轮 · 模型声称已经完成",
              "没有 run_python，模型无法验证测试结果。这里的“完成”只是声明，不是可执行证据。",
              ["model", "loop", "run_python"],
              "BLOCKED",
            );
          } else {
            push(
              "model",
              "第 3 轮 · 模型决定运行测试",
              "模型根据写入结果请求 run_python，验证交付是否满足契约。",
              ["model", "loop", "run_python"],
              "READY",
            );
            invokeTool(
              "run_python",
              "run_python(unittest) → 4 tests passed, exit 0",
              "测试输出与退出码表明 4/4 通过。这个 Observation 才能支撑“修好了”。",
              ["run_python"],
            );

            modelTurns += 1;
            push(
              "model",
              "第 4 轮 · 模型汇总可观察结果",
              "模型依据测试 Observation 汇报完成，而不是凭猜测宣布成功。",
              ["model", "loop"],
              "PASS",
            );
          }
        }
      }
    }

    const checks = [
      {
        ...TASK.checks[0],
        passed: hasRead && toolCalls >= 1,
      },
      {
        ...TASK.checks[1],
        passed: hasRead && hasLoop && hasWrite && toolCalls >= 2,
      },
      {
        ...TASK.checks[2],
        passed: hasRead && hasLoop && hasWrite && hasRun && toolCalls >= 3,
      },
    ];
    const completed = checks.filter((check) => check.passed).length;
    const allDone = completed === checks.length;
    let taskStatus = completed === 0 ? "BLOCKED" : "INCOMPLETE";
    if (allDone) taskStatus = hasEval ? "PASS" : "UNVERIFIED";

    if (hasEval) {
      if (allDone) {
        push(
          "eval",
          "任务验收 · PASS",
          "三个交付检查均由可观察 Observation 支撑：读取、写入、测试退出 0。",
          ["eval"],
          "PASS",
        );
      } else {
        push(
          "eval",
          "任务验收 · FAIL",
          `只完成 ${completed}/3 个交付检查；不会把模型的语言结论当作任务通过。`,
          ["eval"],
          "FAIL",
        );
      }
    } else if (allDone) {
      push(
        "system",
        "动作完成，但没有 Eval",
        "读取、写入、测试都发生了，但系统没有按任务契约形成验收结论，结果只能标记为 UNVERIFIED。",
        ["eval"],
        "UNVERIFIED",
      );
    }

    if (!hasTrace) {
      push(
        "system",
        "系统 Trace 未开启",
        "教学视图仍会展示本次演示过程，但 Agent 自己没有留下可复核的运行轨迹。",
        ["trace"],
        "UNVERIFIED",
      );
    }

    let safetyStatus = "UNKNOWN";
    let safetyLabel = "未设执行边界";
    if (hasGuardrail && toolCalls > 0) {
      safetyStatus = "PASS";
      safetyLabel = `${toolCalls} 次动作经过边界检查`;
    } else if (hasGuardrail) {
      safetyStatus = "READY";
      safetyLabel = "已装配，本次未触发工具";
    }

    let evidenceStatus = "NONE";
    let evidenceLabel = "没有系统证据";
    if (hasTrace && hasEval) {
      evidenceStatus = "FULL";
      evidenceLabel = "轨迹 + 验收";
    } else if (hasTrace) {
      evidenceStatus = "TRACE_ONLY";
      evidenceLabel = "有轨迹，无验收";
    } else if (hasEval) {
      evidenceStatus = "EVAL_ONLY";
      evidenceLabel = "有验收，无轨迹";
    }

    let registryStatus = "MANUAL";
    let registryLabel = "手写分发 / 未统一";
    if (hasRegistry && activeTool) {
      registryStatus = "ACTIVE";
      registryLabel = `${toolCalls} 次工具契约解析`;
    } else if (hasRegistry) {
      registryStatus = "READY";
      registryLabel = "已装配，本次未调用";
    }

    let estimatedMs = modelTurns * COST_MODEL.modelTurnMs + toolCalls * COST_MODEL.toolCallMs;
    if (hasGuardrail) estimatedMs += toolCalls * COST_MODEL.guardrailPerToolMs;
    if (hasRegistry) estimatedMs += toolCalls * COST_MODEL.registryPerToolMs;
    if (hasTrace) estimatedMs += COST_MODEL.traceFixedMs + events.length * COST_MODEL.traceEventMs;
    if (hasEval) estimatedMs += COST_MODEL.evalMs;

    let breakpointNarrative;
    if (!hasRead) {
      breakpointNarrative = "模型有任务意图，但没有能改变环境的动作。最小补丁是 read_file；只加 Loop 也不会凭空产生第一次工具调用。";
    } else if (!hasLoop) {
      breakpointNarrative = "read_file 已经执行，但 Observation 没有回到下一轮。你看到的是“只动了一下”，不是连续任务。";
    } else if (!hasWrite) {
      breakpointNarrative = "Agent 已经知道文件内容，却没有修改能力。此时缺的是 write_file，而不是更多 Prompt。";
    } else if (!hasRun) {
      breakpointNarrative = "文件可能已经改动，但没有测试 Observation。“模型说完成”不能替代测试通过。";
    } else if (!hasEval) {
      breakpointNarrative = "三个动作都完成了，但系统没有按任务契约给出验收结论，所以只能算 UNVERIFIED。";
    } else {
      breakpointNarrative = "任务通过 Eval 验收：交付动作已经走完，并形成了独立验收结论。";
    }

    const boundaryOutcome = hasGuardrail
      ? (toolCalls > 0
        ? {
          value: "PASS",
          title: "有边界，也触发了检查",
          detail: `Guardrail 在 ${toolCalls} 次有副作用动作前完成了检查。`,
          tone: "good",
        }
        : {
          value: "READY",
          title: "有边界，但本次未触发",
          detail: "Guardrail 已装配；本次没有工具调用，因此不能记成一次真实拦截。",
          tone: "info",
        })
      : {
        value: "UNKNOWN",
        title: "Harness 层没有执行边界",
        detail: "没有 Guardrail：本次工具动作没有经过统一的 workspace、风险或审批检查。",
        tone: "bad",
      };

    const auditabilityOutcome = hasTrace
      ? (hasEval
        ? {
          value: "FULL",
          title: "轨迹与验收都在",
          detail: `Trace 记录了 ${events.length} 个事件，同时存在 Eval 验收结论；可复核证据类型完整。`,
          tone: "good",
        }
        : {
          value: "TRACE_ONLY",
          title: "能复盘过程，缺验收",
          detail: `Trace 记录了 ${events.length} 个事件，但没有 Eval；可审计性只有过程证据。`,
          tone: "warn",
        })
      : {
        value: "NONE",
        title: "没有可复核的系统轨迹",
        detail: "没有 Trace：本次只有页面教学重放，Agent 自己没有留下系统可审计的运行记录。",
        tone: "bad",
      };

    const status = statusCopy(taskStatus);
    const taskOutcome = {
      value: taskStatus,
      title: status.label,
      detail: hasEval
        ? (allDone
          ? "Eval 按任务契约确认 3/3 交付检查通过。这个结论只覆盖当前任务。"
          : `Eval 已运行，但只确认 ${completed}/3 个交付检查；不会把模型自述当作 PASS。`)
        : (allDone
          ? "动作都出现了，但没有 Eval；系统不能形成任务 PASS。"
          : `当前只有 ${completed}/3 个交付检查有证据，且没有 Eval 验收。`),
      tone: status.tone,
    };

    const outcomes = [
      { key: "task", label: "任务验收", eyebrow: "DELIVERY", ...taskOutcome },
      { key: "boundary", label: "执行边界", eyebrow: "SAFETY", ...boundaryOutcome },
      { key: "auditability", label: "可审计性", eyebrow: "EVIDENCE", ...auditabilityOutcome },
    ];

    const governanceSentence = `执行边界 ${boundaryOutcome.value}（${boundaryOutcome.title}）；可审计性 ${auditabilityOutcome.value}（${auditabilityOutcome.title}）。`;
    const narrative = `${breakpointNarrative} ${governanceSentence}`;

    const governanceNotes = [];
    if (!hasRegistry) governanceNotes.push("无 Registry：本次靠固定任务脚本运行，不证明多工具分发的一致性。");
    if (!hasGuardrail) governanceNotes.push("无 Guardrail：写入和执行没有 Harness 层边界检查。");
    if (!hasTrace) governanceNotes.push("无 Trace：没有留下系统可复核的运行轨迹。");
    if (!hasEval) governanceNotes.push("无 Eval：完成度只能描述动作，不能形成任务 PASS。");
    if (!governanceNotes.length) governanceNotes.push("治理组件齐全，但它们带来额外检查与耗时；是否值得仍要由真实任务和 Eval 决定。");

    return {
      task: TASK,
      selection: normalizeSelection(selection),
      components: selectedComponents(selection),
      events,
      checks,
      completed,
      total: checks.length,
      taskStatus,
      statusLabel: status.label,
      statusDetail: status.detail,
      statusTone: status.tone,
      modelTurns,
      toolCalls,
      estimatedMs,
      estimatedSeconds: Number((estimatedMs / 1000).toFixed(2)),
      safetyStatus,
      safetyLabel,
      registryStatus,
      registryLabel,
      evidenceStatus,
      evidenceLabel,
      evalStatus: hasEval ? (allDone ? "PASS" : "FAIL") : "OFF",
      evalLabel: hasEval ? (allDone ? "3/3 交付通过" : `${completed}/3 交付通过`) : "未运行验收",
      traceStatus: hasTrace ? "ON" : "OFF",
      outcomes,
      narrative,
      governanceNotes,
      costModel: COST_MODEL,
    };
  }

  const LEARNING_ORDER = [
    "read_file",
    "loop",
    "write_file",
    "run_python",
    "eval",
    "guardrail",
    "trace",
    "registry",
  ];

  const RECOMMENDATION_GUIDANCE = {
    read_file: {
      reason: "现在只有模型，首个真实动作不会发生；先补一个读取工具，才能看到 Observation。",
      expected: "任务会从 BLOCKED 变成 INCOMPLETE，并出现 1 次文件读取。",
    },
    loop: {
      reason: "read_file 已经能动作，但 Observation 回不到模型；先补 Loop，才能出现下一轮决策。",
      expected: "工具结果会写回对话；任务仍会停住，但断点会推进到“缺少写入”。",
    },
    write_file: {
      reason: "模型已经知道当前版本，却没有修改文件的能力；补写入工具，才能完成第二步。",
      expected: "完成度会从 1/3 变成 2/3，随后暴露“没有测试证据”。",
    },
    run_python: {
      reason: "文件可能已改，但完成声明还没有测试 Observation；补测试工具才能验证交付。",
      expected: "完成度会到 3/3，但任务仍只是 UNVERIFIED，因为还没有 Eval。",
    },
    eval: {
      reason: "动作全部完成不等于任务可信通过；补 Eval，才能按契约形成独立验收结论。",
      expected: "任务验收会从 UNVERIFIED 变成 PASS；边界与可审计性仍可能缺失。",
    },
    guardrail: {
      reason: "任务可能已经 PASS，但工具副作用前没有 Harness 边界；补 Guardrail 检验安全声明。",
      expected: "有工具动作时，执行边界会从 UNKNOWN 变成 PASS；可审计性仍保持 NONE。",
    },
    trace: {
      reason: "现在有任务结论，却没有系统可复核过程；补 Trace，才能区分结果和证据。",
      expected: "可审计性会从 NONE 变成 FULL（同时已有 Eval），任务结果不应改变。",
    },
    registry: {
      reason: "最后补统一工具契约，观察分发一致性是否提升，而任务能力不因此自动变强。",
      expected: "Registry 会从手写分发变成 ACTIVE；完成度与验收结论保持不变。",
    },
  };

  function recommendNextExperiments(selection) {
    const current = normalizeSelection(selection);
    const selected = new Set(current);
    const componentId = LEARNING_ORDER.find((id) => !selected.has(id));
    if (!componentId) return [];
    const component = componentById(componentId);
    const guidance = RECOMMENDATION_GUIDANCE[componentId];
    return [{
      componentId,
      component,
      selection: normalizeSelection([...current, componentId]),
      reason: guidance.reason,
      expected: guidance.expected,
    }];
  }

  function compareRuns(a, b) {
    if (!a || !b) return null;
    const taskDelta = STATUS_RANK[b.taskStatus] - STATUS_RANK[a.taskStatus];
    const safetyDelta = SAFETY_RANK[b.safetyStatus] - SAFETY_RANK[a.safetyStatus];
    const evidenceDelta = EVIDENCE_RANK[b.evidenceStatus] - EVIDENCE_RANK[a.evidenceStatus];
    const durationDelta = b.estimatedSeconds - a.estimatedSeconds;
    const aSelection = new Set(normalizeSelection(a.selection));
    const bSelection = new Set(normalizeSelection(b.selection));
    const changedComponents = COMPONENTS
      .filter((component) => aSelection.has(component.id) !== bSelection.has(component.id))
      .map((component) => component.id);
    const addedComponents = COMPONENTS
      .filter((component) => !aSelection.has(component.id) && bSelection.has(component.id))
      .map((component) => component.id);
    const removedComponents = COMPONENTS
      .filter((component) => aSelection.has(component.id) && !bSelection.has(component.id))
      .map((component) => component.id);
    const changedNames = changedComponents.map((id) => componentById(id).name);
    let mode = "multivariate";
    if (changedComponents.length === 0) mode = "repeat";
    else if (changedComponents.length === 1) mode = "controlled";
    const warning = mode === "multivariate"
      ? `多变量变化：${changedNames.join("、")} 同时改变，不能把结果差异归因给单一组件。`
      : null;
    let summary;
    if (mode === "repeat") {
      summary = "重复运行：装配没有变化，确定性模拟会得到相同结果。";
    } else if (mode === "controlled") {
      summary = `受控对照：只加入${changedNames[0]}。本次差异可以优先归因于这一块，但仍需结合结果检查。`;
    } else {
      summary = warning;
    }
    return {
      a,
      b,
      mode,
      isRepeat: mode === "repeat",
      isControlled: mode === "controlled",
      changedComponents,
      addedComponents,
      removedComponents,
      warning,
      summary,
      metrics: [
        {
          key: "completion",
          label: "动作完成",
          a: `${a.completed}/${a.total}`,
          b: `${b.completed}/${b.total}`,
          delta: signed(b.completed - a.completed, " 项"),
          tone: b.completed > a.completed ? "good" : b.completed < a.completed ? "bad" : "same",
        },
        {
          key: "task",
          label: "验收结论",
          a: a.taskStatus,
          b: b.taskStatus,
          delta: taskDelta > 0 ? "提升" : taskDelta < 0 ? "下降" : "相同",
          tone: taskDelta > 0 ? "good" : taskDelta < 0 ? "bad" : "same",
        },
        {
          key: "duration",
          label: "模拟耗时",
          a: formatSeconds(a.estimatedMs),
          b: formatSeconds(b.estimatedMs),
          delta: `${durationDelta >= 0 ? "+" : ""}${durationDelta.toFixed(2)}s`,
          tone: "cost",
        },
        {
          key: "tools",
          label: "工具调用",
          a: String(a.toolCalls),
          b: String(b.toolCalls),
          delta: signed(b.toolCalls - a.toolCalls, " 次"),
          tone: b.toolCalls > a.toolCalls ? "info" : b.toolCalls < a.toolCalls ? "info" : "same",
        },
        {
          key: "safety",
          label: "执行边界",
          a: a.safetyStatus,
          b: b.safetyStatus,
          delta: safetyDelta > 0 ? "增强" : safetyDelta < 0 ? "减弱" : "相同",
          tone: safetyDelta > 0 ? "good" : safetyDelta < 0 ? "bad" : "same",
        },
        {
          key: "evidence",
          label: "系统证据",
          a: a.evidenceStatus,
          b: b.evidenceStatus,
          delta: evidenceDelta > 0 ? "增强" : evidenceDelta < 0 ? "减弱" : "相同",
          tone: evidenceDelta > 0 ? "good" : evidenceDelta < 0 ? "bad" : "same",
        },
      ],
    };
  }

  function costBasisText() {
    return `教学估算：模型 ${COST_MODEL.modelTurnMs}ms/回合 + 工具 ${COST_MODEL.toolCallMs}ms/次 + 边界 ${COST_MODEL.guardrailPerToolMs}ms/工具 + Registry ${COST_MODEL.registryPerToolMs}ms/工具 + Trace ${COST_MODEL.traceFixedMs}ms 起 + ${COST_MODEL.traceEventMs}ms/事件 + Eval ${COST_MODEL.evalMs}ms。`;
  }

  return {
    TASK,
    COMPONENTS,
    GROUPS,
    PRESETS,
    COST_MODEL,
    DEFAULT_SELECTION: [],
    componentById,
    normalizeSelection,
    selectedComponents,
    simulateRun,
    compareRuns,
    recommendNextExperiments,
    formatSeconds,
    costBasisText,
  };
});
