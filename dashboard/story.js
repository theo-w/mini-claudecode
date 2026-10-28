"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AgentStory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const EVENT_ORDER = ["run_started", "model_request", "model_response", "tool_call", "tool_result", "history_compaction", "run_finished"];

  function number(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function sequenceOf(event, fallback = 0) {
    return number(event?.sequence) ?? number(event?.event_index) ?? fallback;
  }

  function parseArguments(value) {
    if (value === null || value === undefined || value === "") return {};
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch (_) { return value; }
  }

  function compactValue(value, max = 110) {
    if (value === null || value === undefined || value === "") return "未记录参数";
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    const text = raw.replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function argumentSummary(event) {
    const args = parseArguments(event?.arguments);
    if (!args || typeof args !== "object" || Array.isArray(args)) return compactValue(args);
    if (typeof args.file_path === "string") {
      const range = args.start_line || args.end_line
        ? `，第 ${args.start_line ?? "?"}–${args.end_line ?? "?"} 行`
        : "";
      return `${args.file_path}${range}`;
    }
    if (typeof args.dir_path === "string") return args.dir_path;
    if (typeof args.pattern === "string") return `“${args.pattern}”`;
    if (typeof args.query === "string") return `“${args.query}”`;
    return compactValue(args);
  }

  function modelRequestSummary(event) {
    if (!event) return "模型请求摘要未记录。";
    const chars = number(event.context_chars);
    const messages = number(event.message_count);
    const observationChars = number(event.tool_observation_chars);
    const parts = [];
    if (messages !== null) parts.push(`${messages} 条消息`);
    if (chars !== null) parts.push(`${chars.toLocaleString("zh-CN")} 字符`);
    if (observationChars) parts.push(`其中工具 observation ${observationChars.toLocaleString("zh-CN")} 字符`);
    return parts.length ? `模型收到 ${parts.join("、")}。` : "模型请求已发送，详细上下文未记录。";
  }

  function observationSummary(input) {
    const event = typeof input === "object" && input !== null ? input : { event: "tool_result", content: input };
    if (event.event === "history_compaction") {
      if (event.compacted) {
        const evidence = number(event.evidence_count);
        const before = number(event.context_chars_before);
        const after = number(event.context_chars_after);
        const size = before !== null && after !== null ? `上下文 ${before.toLocaleString("zh-CN")} → ${after.toLocaleString("zh-CN")} 字符` : "历史已压缩";
        return `压缩策略生效：${size}${evidence !== null ? `，保留 ${evidence} 条证据` : ""}。`;
      }
      const reason = event.reason ? `原因：${event.reason}` : "未记录原因";
      return `本轮没有压缩历史；${reason}。`;
    }
    if (event.event === "approval_denied") return `审批未通过，${event.tool || "工具"} 没有执行。`;
    if (event.event === "invalid_tool_arguments") return `工具参数无效，Harness 没有执行 ${event.tool || "工具"}。`;
    if (event.event === "model_error") return `模型异常：${compactValue(event.error || event.content || "未记录")}`;

    const content = String(event.content || event.error || "").trim();
    if (!content) return event.ok === false ? "工具返回失败，但没有记录错误内容。" : "此事件没有文本内容。";

    const [headerBlock, ...bodyParts] = content.split(/\n---\n/);
    const metadata = {};
    headerBlock.split("\n").forEach((line) => {
      const match = line.match(/^([a-z_]+):\s*(.*)$/);
      if (match) metadata[match[1]] = match[2];
    });
    if (metadata.returned_range) {
      const parts = [`读取第 ${metadata.returned_range.replace("-", "–")} 行`];
      if (metadata.total_lines) parts.push(`文件共 ${metadata.total_lines} 行`);
      if (metadata.has_more === "true" && metadata.next_start_line) parts.push(`还有后续内容；从第 ${metadata.next_start_line} 行继续`);
      else if (metadata.has_more === "false") parts.push("已到文件末尾");
      if (metadata.budget_limited === "true") parts.push("本次受 observation 预算限制");
      return `${parts.join("，")}。`;
    }

    const firstLine = content.split("\n").find((line) => line.trim()) || "";
    return firstLine.length > 150 ? `${firstLine.slice(0, 150)}…` : firstLine;
  }

  function firstByType(events, eventType) {
    return events.find((event) => event.event === eventType) || null;
  }

  function lastByType(events, eventType) {
    return [...events].reverse().find((event) => event.event === eventType) || null;
  }

  function pairCalls(events) {
    const explicitCalls = events.filter((event) => event.event === "tool_call");
    const knownIds = new Set(explicitCalls.map((event) => event.call_id).filter(Boolean));
    const derivedCalls = [];
    events.filter((event) => event.event === "model_response").forEach((response) => {
      (response.tool_calls || []).forEach((toolCall) => {
        if (toolCall.id && knownIds.has(toolCall.id)) return;
        derivedCalls.push({
          event: "tool_call",
          step: response.step,
          tool: toolCall.name,
          call_id: toolCall.id || null,
          arguments: parseArguments(toolCall.arguments),
          sequence: response.sequence,
          inferred_from_response: true,
        });
      });
    });
    const calls = [...explicitCalls, ...derivedCalls]
      .sort((a, b) => sequenceOf(a) - sequenceOf(b))
      .map((call) => ({ call, result: null }));
    const results = events.filter((event) => event.event === "tool_result");
    const claimed = new Set();

    calls.forEach((entry) => {
      if (!entry.call.call_id) return;
      const result = results.find((candidate) => !claimed.has(candidate) && candidate.call_id === entry.call.call_id && (
        !entry.call.tool || !candidate.tool || candidate.tool === entry.call.tool
      ));
      if (result) {
        entry.result = result;
        claimed.add(result);
      }
    });
    calls.forEach((entry) => {
      if (entry.result) return;
      const result = results.find((candidate) => !claimed.has(candidate) && (
        !entry.call.tool || !candidate.tool || candidate.tool === entry.call.tool
      ));
      if (result) {
        entry.result = result;
        claimed.add(result);
      }
    });
    return calls;
  }

  function roundBranch(round) {
    if (round.errors.length) return { type: "error", tools: [] };
    if (round.calls.length) {
      return { type: "tool", tools: [...new Set(round.calls.map((entry) => entry.call.tool).filter(Boolean))] };
    }
    const response = lastByType(round.responses, "model_response");
    if (response && !(response.tool_calls || []).length) return { type: "finish", tools: [] };
    return { type: "continue", tools: [] };
  }

  function roundNarrative(round) {
    const request = firstByType(round.requests, "model_request");
    const compaction = lastByType(round.compactions, "history_compaction");
    const parts = [modelRequestSummary(request)];
    if (compaction?.compacted) parts.push(observationSummary(compaction));

    if (round.errors.length) {
      parts.push(observationSummary(round.errors[0]));
      return { headline: `第 ${round.step} 轮遇到异常`, detail: parts.join(" ") };
    }

    if (round.calls.length) {
      const toolText = round.calls.map((entry) => `${entry.call.tool || "unknown"}（${argumentSummary(entry.call)}）`).join("、");
      const results = round.calls.map((entry) => observationSummary(entry.result)).filter(Boolean);
      parts.push(`模型决定调用 ${toolText}。`);
      if (results.length) parts.push(results.join(" "));
      parts.push("工具结果写回上下文，进入下一轮模型判断。");
      return { headline: `第 ${round.step} 轮 · 调用 ${round.calls.map((entry) => entry.call.tool || "unknown").join(" + ")}`, detail: parts.join(" ") };
    }

    const response = lastByType(round.responses, "model_response");
    if (response && !(response.tool_calls || []).length) {
      const finalText = String(response.content || "").trim();
      parts.push("模型没有再请求工具。");
      if (finalText) parts.push(`最终响应：${compactValue(finalText, 220)}`);
      return { headline: `第 ${round.step} 轮 · Agent 停止调用工具`, detail: parts.join(" ") };
    }

    parts.push("本轮没有可展示的模型决定。");
    return { headline: `第 ${round.step} 轮 · 信息未完整记录`, detail: parts.join(" ") };
  }

  function groupRounds(record) {
    const events = Array.isArray(record?.events) ? record.events : [];
    const roundsByStep = new Map();
    const runEvents = [];

    events.forEach((event, index) => {
      const sequenced = { ...event, sequence: sequenceOf(event, index) };
      const step = number(sequenced.step);
      if (step === null) {
        runEvents.push(sequenced);
        return;
      }
      if (!roundsByStep.has(step)) {
        roundsByStep.set(step, {
          step,
          events: [],
          requests: [],
          responses: [],
          toolCalls: [],
          toolResults: [],
          compactions: [],
          approvals: [],
          errors: [],
          calls: [],
        });
      }
      const round = roundsByStep.get(step);
      round.events.push(sequenced);
      if (sequenced.event === "model_request") round.requests.push(sequenced);
      else if (sequenced.event === "model_response") round.responses.push(sequenced);
      else if (sequenced.event === "tool_call") round.toolCalls.push(sequenced);
      else if (sequenced.event === "tool_result") round.toolResults.push(sequenced);
      else if (sequenced.event === "history_compaction") round.compactions.push(sequenced);
      else if (sequenced.event === "approval_denied" || sequenced.event === "invalid_tool_arguments") round.approvals.push(sequenced);
      else if (["model_error", "compaction_model_error"].includes(sequenced.event)) round.errors.push(sequenced);
    });

    const rounds = [...roundsByStep.values()]
      .sort((a, b) => a.step - b.step)
      .map((round) => {
        round.events.sort((a, b) => a.sequence - b.sequence);
        round.calls = pairCalls(round.events);
        round.branch = roundBranch(round);
        round.narrative = roundNarrative(round);
        return round;
      });
    const finalResponse = [...events].reverse().find((event) => event.event === "model_response" && !(event.tool_calls || []).length) || null;
    return { rounds, runEvents, finalResponse };
  }

  function toolPath(record) {
    const grouped = groupRounds(record);
    const calls = grouped.rounds.flatMap((round) => round.calls);
    const usedTools = [];
    calls.forEach((entry) => {
      if (entry.call.tool && !usedTools.includes(entry.call.tool)) usedTools.push(entry.call.tool);
    });
    return {
      totalCalls: calls.length,
      usedTools,
      steps: grouped.rounds
        .filter((round) => round.calls.length)
        .map((round) => ({ step: round.step, tools: [...new Set(round.calls.map((entry) => entry.call.tool).filter(Boolean))] })),
    };
  }

  function loopJourney(record) {
    return groupRounds(record).rounds.map((round) => {
      const request = firstByType(round.requests, "model_request");
      const response = lastByType(round.responses, "model_response");
      return {
        step: round.step,
        branch: round.branch.type,
        tools: round.branch.tools,
        requestSequence: request?.sequence ?? round.events[0]?.sequence ?? 0,
        responseSequence: response?.sequence ?? round.events[0]?.sequence ?? 0,
      };
    });
  }

  function loopNodeForEvent(event) {
    if (!event) return "idle";
    if (event.event === "run_started") return "start";
    if (event.event === "model_request") return "context";
    if (event.event === "model_response") return (event.tool_calls || []).length ? "decision" : "finish";
    if (event.event === "tool_call") return "tool";
    if (event.event === "tool_result") return "observation";
    if (event.event === "history_compaction") return "compaction";
    if (event.event === "approval_denied" || event.event === "invalid_tool_arguments") return "approval";
    if (event.event === "run_finished") return "finish";
    if (event.event === "model_error" || event.event === "compaction_model_error") return "error";
    return "evidence";
  }

  function firstCheckDifference(aRecord, bRecord) {
    const aChecks = aRecord?.checks || [];
    const bChecks = bRecord?.checks || [];
    const length = Math.max(aChecks.length, bChecks.length);
    for (let index = 0; index < length; index += 1) {
      const a = aChecks[index] || null;
      const b = bChecks[index] || null;
      if (!a || !b || a.check !== b.check || a.passed !== b.passed) return { index, a, b };
    }
    return null;
  }

  function findFirstDivergence(aRun, bRun) {
    const aRecords = new Map((aRun?.records || []).map((record) => [record.id, record]));
    const bRecords = new Map((bRun?.records || []).map((record) => [record.id, record]));
    const ids = [...aRecords.keys(), ...[...bRecords.keys()].filter((id) => !aRecords.has(id))];

    let firstCheckOnly = null;
    for (const taskId of ids) {
      const aRecord = aRecords.get(taskId) || null;
      const bRecord = bRecords.get(taskId) || null;
      const outcomeDiffers = !aRecord || !bRecord || Boolean(aRecord.passed) !== Boolean(bRecord.passed);
      if (outcomeDiffers) {
        return {
          type: "result",
          taskId,
          a: aRecord,
          b: bRecord,
          check: aRecord && bRecord ? firstCheckDifference(aRecord, bRecord) : null,
        };
      }
      if (!firstCheckOnly) {
        const check = firstCheckDifference(aRecord, bRecord);
        if (check) firstCheckOnly = { type: "check", taskId, a: aRecord, b: bRecord, check };
      }
    }
    return firstCheckOnly || {
      type: "none",
      taskId: null,
      a: null,
      b: null,
      check: null,
    };
  }

  function outcomeText(record) {
    if (!record) return "无任务";
    const passed = record.passed === true;
    return passed ? "PASS" : (record.passed === false ? "FAIL" : (record.status || "未记录"));
  }

  return {
    EVENT_ORDER,
    argumentSummary,
    findFirstDivergence,
    firstCheckDifference,
    groupRounds,
    loopJourney,
    loopNodeForEvent,
    modelRequestSummary,
    observationSummary,
    outcomeText,
    parseArguments,
    toolPath,
  };
});
