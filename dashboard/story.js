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

  function parseObservationMetadata(input) {
    const event = typeof input === "object" && input !== null ? input : { event: "tool_result", content: input };
    const content = String(event?.content || event?.error || "").trim();
    const headerBlock = content.split(/\n---\n/, 1)[0] || "";
    const raw = {};
    headerBlock.split("\n").forEach((line) => {
      const match = line.match(/^([a-z_]+):\s*(.*)$/);
      if (match) raw[match[1]] = match[2].trim();
    });
    const boolean = (value) => value === "true" ? true : (value === "false" ? false : null);
    return {
      returned_range: raw.returned_range || null,
      requested_range: raw.requested_range || null,
      total_lines: number(raw.total_lines),
      has_more: boolean(raw.has_more),
      file_has_more: boolean(raw.file_has_more),
      next_start_line: number(raw.next_start_line),
      budget_limited: boolean(raw.budget_limited),
      raw,
    };
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

    const metadata = parseObservationMetadata(event);
    if (metadata.returned_range) {
      const parts = [`读取第 ${metadata.returned_range.replace("-", "–")} 行`];
      if (metadata.total_lines !== null) parts.push(`文件共 ${metadata.total_lines} 行`);
      if (metadata.has_more === true && metadata.next_start_line !== null) parts.push(`还有后续内容；从第 ${metadata.next_start_line} 行继续`);
      else if (metadata.has_more === false) parts.push("已到文件末尾");
      if (metadata.budget_limited === true) parts.push("本次受 observation 预算限制");
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
      parts.push(`model_response 中包含 tool_call：${toolText}。`);
      if (results.length) parts.push(results.join(" "));
      parts.push("工具 observation 被记录，并用于构造下一次 model_request；内部动机未记录。");
      return { headline: `第 ${round.step} 轮 · 调用 ${round.calls.map((entry) => entry.call.tool || "unknown").join(" + ")}`, detail: parts.join(" ") };
    }

    const response = lastByType(round.responses, "model_response");
    if (response && !(response.tool_calls || []).length) {
      const finalText = String(response.content || "").trim();
      parts.push("这条 model_response 不含 tool_calls，Trace 在此进入停止分支。");
      if (finalText) parts.push(`最终响应：${compactValue(finalText, 220)}`);
      return { headline: `第 ${round.step} 轮 · 无 tool_calls 的停止证据`, detail: parts.join(" ") };
    }

    parts.push("本轮没有可展示的 tool_call 或停止响应。");
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

  function fixtureSummary(contract) {
    const fixtures = Array.isArray(contract?.fixtures) ? contract.fixtures : [];
    const hasContract = Boolean(contract && typeof contract === "object");
    const explained = fixtures.map((fixture) => {
      const path = fixture?.path || "未记录路径";
      const kind = fixture?.kind || "unknown";
      const lineCount = number(fixture?.line_count);
      let composition = "行数未记录";
      if (kind === "repeated") {
        const repeat = number(fixture.repeat);
        const repeatLines = number(fixture.repeat_lines);
        const headLines = number(fixture.head_lines) ?? 0;
        const tailLines = number(fixture.tail_lines) ?? 0;
        const parts = [];
        if (headLines > 0) parts.push(`${headLines}`);
        if (repeat !== null && repeatLines !== null) parts.push(`${repeat} × ${repeatLines}`);
        if (tailLines > 0) parts.push(`${tailLines}`);
        const formula = parts.join(" + ");
        composition = formula
          ? `${formula}${lineCount !== null ? ` = ${lineCount}` : ""} 行`
          : (lineCount !== null ? `${lineCount} 行` : "行数未记录");
      } else if (kind === "text" && lineCount !== null) {
        composition = `${lineCount} 行文本`;
      } else if (kind === "structured") {
        composition = "结构化 fixture · 行数未记录";
      }
      return { path, kind, lineCount, composition, headLines: number(fixture?.head_lines), repeatLines: number(fixture?.repeat_lines), repeat: number(fixture?.repeat), tailLines: number(fixture?.tail_lines) };
    });
    const knownLineCounts = explained.map((fixture) => fixture.lineCount).filter((value) => value !== null);
    return {
      hasContract,
      fixtures: explained,
      totalLineCount: knownLineCounts.length ? knownLineCounts.reduce((sum, value) => sum + value, 0) : null,
      composition: explained.length
        ? explained.map((fixture) => `${fixture.path} · ${fixture.composition}`).join("；")
        : (hasContract ? "任务契约没有 fixture 摘要" : "未导入任务契约，不能推断 fixture 规模"),
    };
  }

  function checkTarget(raw, prefix) {
    if (!raw.startsWith(`${prefix}:`)) return null;
    const rest = raw.slice(prefix.length + 1);
    const actualIndex = rest.indexOf(":actual=");
    return (actualIndex >= 0 ? rest.slice(0, actualIndex) : rest).replace(/^['"]|['"]$/g, "") || null;
  }

  function classifyCheck(input) {
    const check = input && typeof input === "object" ? input : { check: String(input ?? "") };
    const raw = String(check.check || "");
    const lower = raw.toLowerCase();
    const skipped = raw.match(/(?:^|:)skipped=([^:]+)/i);
    let status = check.passed === true ? "PASS" : (check.passed === false ? "FAIL" : "UNKNOWN");
    let skipReason = null;
    if (skipped) {
      status = "SKIP";
      const flag = skipped[1].toLowerCase();
      if (["off", "disabled", "none", "not_enabled"].includes(flag)) {
        skipReason = "策略关闭，检查跳过，不代表压缩成功。";
      } else if (["missing", "not_recorded", "unavailable", "unknown"].includes(flag)) {
        skipReason = `证据标记为 ${skipped[1]}，检查跳过，不能视为通过。`;
      } else {
        skipReason = `检查标记为 skipped=${skipped[1]}，检查跳过，不能视为通过。`;
      }
    }

    const type = lower.split(":", 1)[0];
    let group = "other";
    let label = raw || "未记录 check";
    let purpose = "这是一项自定义检查；页面不猜它的业务目的。";
    let prevents = "防止未记录检查被误读为已通过。";
    let failure = "检查失败：该断言没有被当前报告满足。";
    let mechanism = "结果验收";

    if (["output_contains", "final_output_contains", "answer_contains", "exact_output", "equals"].includes(type)) {
      group = "acceptance";
      const target = checkTarget(raw, type);
      label = target ? `最终输出包含 ${target}` : "最终输出满足验收条件";
      purpose = "确认最终答案确实带有任务要求的证据值，而不是只完成了一个相似任务。";
      prevents = target
        ? `防止最终答案缺少 ${target}、被改写，或只报告了过程而没有交付结果。`
        : "防止过程看似完成，但最终输出缺少验收证据。";
      failure = "最终输出没有满足文字验收条件；答案可能缺失、被改写或超出了要求格式。";
      mechanism = "结果验收 · 最终响应";
    } else if (["tool_not_called", "tool_forbidden", "no_tool_called"].includes(type)) {
      group = "constraint";
      const target = checkTarget(raw, type) || "禁用工具";
      label = `未调用禁用工具 ${target}`;
      purpose = "确认 Agent 走了任务指定的工具路径，而不是用更省事的旁路完成。";
      prevents = `防止改用 ${target} 绕过指定工具、跳过完整读取，最后却因为答案碰巧正确而被判成功。`;
      failure = `Trace 中出现了 ${target} 调用；即使最终答案正确，也没有满足过程约束。`;
      mechanism = "工具选择 · 过程约束";
    } else if (["max_steps", "max_tool_calls", "within_step_budget"].includes(type)) {
      group = "constraint";
      label = "运行没有越过预算";
      purpose = "确认任务在声明的步数或调用预算内完成。";
      prevents = "防止靠无限重试或过量调用堆出结果，掩盖 Loop 没有收敛。";
      failure = "运行越过预算，不能证明当前 Loop 能在有限步骤内完成任务。";
      mechanism = "Loop 边界 · 资源约束";
    } else if (["tool_succeeded", "tool_failed"].includes(type)) {
      group = "capability";
      const target = checkTarget(raw, type) || "指定工具";
      const wantsFailure = type === "tool_failed";
      label = wantsFailure ? `${target} 返回过失败 observation` : `${target} 至少成功一次`;
      purpose = wantsFailure
        ? "确认失败路径真实发生过，并留下了可复核的工具错误。"
        : "确认工具调用不只是被请求，而是真实执行并返回了成功 observation。";
      prevents = wantsFailure
        ? "防止把工具失败静默吞掉，或只展示成功路径却声称经历过错误恢复。"
        : "防止只有 tool_call、没有 tool_result，或工具报错却被最终文案掩盖。";
      failure = wantsFailure
        ? `Trace 中没有 ${target} 的失败 observation，失败恢复实验缺少起点。`
        : `Trace 中没有 ${target} 的成功 observation，无法证明该能力真实执行。`;
      mechanism = "工具执行 · Observation";
    } else if (["tool_call_count_at_least", "tool_call_count", "tool_used_at_least"].includes(type)) {
      group = "capability";
      const target = checkTarget(raw, type) || "工具";
      const actual = number((raw.match(/:actual=(\d+)/) || [])[1]);
      label = `${target} 调用次数达到下限`;
      purpose = "确认 Agent 确实多次进入工具 Loop，而不是一次读取后猜出答案。";
      prevents = target === "read_file"
        ? "防止只读取文件开头或一小段就猜测全文，尤其是长文件中的尾部证据。"
        : `防止 ${target} 调用次数不足，能力证据来自猜测而不是真实步骤。`;
      failure = actual !== null
        ? `实际记录为 ${actual} 次；没有达到任务要求的调用下限。`
        : "调用次数不足或报告没有记录实际次数。";
      mechanism = "工具回环 · 分页能力";
    } else if (["compaction_count_at_least", "compaction_happened", "compaction_compacted"].includes(type)) {
      group = "integrity";
      const actual = number((raw.match(/:actual=(\d+)/) || [])[1]);
      const skippedMatch = raw.match(/(?:^|:)skipped=([^:]+)/i);
      label = "历史压缩检查达到阈值";
      purpose = "确认上下文压缩策略按预期触发，并留下可复核证据。";
      prevents = "防止把压缩策略关闭或没有触发，误读成压缩成功；也防止压缩后证据被静默丢弃。";
      failure = actual !== null
        ? `实际压缩次数为 ${actual}；检查要求没有满足。`
        : "没有记录可满足阈值的压缩证据。";
      mechanism = "Context 管理 · 压缩完整性";
      if (skippedMatch) {
        purpose = "这项检查本应验证压缩策略，但本次运行明确标记了跳过条件。";
        prevents = "防止 skipped 状态被画成绿色 PASS，把“策略关闭”误读成“压缩成功”。";
        failure = "本次检查没有执行，因此不能给出压缩能力的正反结论。";
      }
    } else if (["program_completed", "run_completed", "trace_complete", "evidence_preserved"].includes(type)) {
      group = "integrity";
      label = "运行和证据完整性";
      purpose = "确认报告有完整结束状态与可复核证据。";
      prevents = "防止截断、异常退出或证据丢失被当成正常完成。";
      failure = "运行或证据链不完整，结果不能作为稳定结论。";
      mechanism = "Trace 完整性";
    }

    return {
      ...check,
      check: raw,
      status,
      passed: check.passed,
      group,
      label,
      purpose,
      prevents,
      failure,
      mechanism,
      skipReason,
    };
  }

  function checkGroups(checks) {
    const definitions = [
      { id: "acceptance", title: "最终验收", subtitle: "答案是否真的交付", description: "检查最终响应是否包含任务要求的证据。它不证明过程正确，只回答结果是否可验收。" },
      { id: "constraint", title: "过程约束", subtitle: "是否走了要求的路", description: "检查工具选择、禁用路径和预算。它防止答案碰巧正确，却绕过了实验想验证的机制。" },
      { id: "capability", title: "能力证据", subtitle: "能力是否真实发生", description: "检查工具、分页和错误恢复是否留下真实执行证据。它防止把 tool_call 或猜测当成能力。" },
      { id: "integrity", title: "实验完整性", subtitle: "结论是否可复核", description: "检查压缩、运行收尾和证据完整性。SKIP 表示本次没有验证，不等于通过。" },
    ];
    const groups = definitions.map((definition) => ({ ...definition, checks: [] }));
    const other = { id: "other", title: "其他检查", subtitle: "尚未分类", description: "新 check 类型没有教学映射时保留原文，并显示 UNKNOWN 语义，不猜它验证什么。", checks: [] };
    const byId = new Map(groups.map((group) => [group.id, group]));
    (Array.isArray(checks) ? checks : []).forEach((check) => {
      const classified = classifyCheck(check);
      (byId.get(classified.group) || other).checks.push(classified);
    });
    if (other.checks.length) groups.push(other);
    return groups.map((group) => {
      const summary = { PASS: 0, FAIL: 0, SKIP: 0, UNKNOWN: 0, total: group.checks.length };
      group.checks.forEach((check) => { summary[check.status] += 1; });
      return { ...group, summary };
    });
  }

  function rangeStart(value) {
    const match = String(value || "").match(/(\d+)\s*-\s*(\d+)/);
    return match ? number(match[1]) : null;
  }

  function observationRange(value) {
    return value ? String(value).replace(/\s*-\s*/, "–") : null;
  }

  function buildCausalChain(record, contract) {
    const grouped = groupRounds(record);
    const turnStages = grouped.rounds
      .filter((round) => round.calls.length)
      .map((round) => {
        const calls = round.calls.map(({ call, result }) => {
          const args = parseArguments(call.arguments);
          const metadata = result ? parseObservationMetadata(result) : null;
          const startLine = number(args?.start_line) ?? rangeStart(metadata?.returned_range);
          return {
            call,
            result,
            args: args && typeof args === "object" ? args : {},
            filePath: typeof args?.file_path === "string" ? args.file_path : null,
            startLine,
            metadata,
            returnedRange: observationRange(metadata?.returned_range),
            nextStartLine: metadata?.next_start_line ?? null,
            hasMore: metadata?.has_more ?? null,
          };
        });
        const primary = calls[calls.length - 1] || null;
        const firstSequence = Math.min(...round.events.map((event) => sequenceOf(event, 0)));
        const lastSequence = Math.max(...round.events.map((event) => sequenceOf(event, 0)));
        return {
          id: `turn-${round.step}`,
          kind: "turn",
          step: round.step,
          title: `Step ${round.step}`,
          call: primary?.call || null,
          observation: primary?.result || null,
          tool: primary?.call?.tool || null,
          args: primary?.args || {},
          filePath: primary?.filePath || null,
          startLine: primary?.startLine ?? null,
          returnedRange: primary?.returnedRange || null,
          nextStartLine: primary?.nextStartLine ?? null,
          hasMore: primary?.hasMore ?? null,
          calls,
          round,
          sequence: primary?.call?.sequence ?? firstSequence,
          firstSequence,
          lastSequence,
          detail: primary?.result ? observationSummary(primary.result) : "没有关联到 tool_result 事件。",
        };
      });

    const firstRequest = grouped.rounds.flatMap((round) => round.requests)[0] || null;
    const fixture = fixtureSummary(contract);
    const question = {
      id: "question",
      kind: "question",
      title: "实验问题",
      prompt: contract?.prompt || "未导入任务契约；页面不能补造任务目标或 fixture 设计。",
      hasContract: fixture.hasContract,
      fixture,
      sequence: firstRequest?.sequence ?? grouped.runEvents[0]?.sequence ?? 0,
    };

    const stopResponse = grouped.finalResponse;
    const stop = stopResponse ? {
      id: "stop",
      kind: "stop",
      title: "停止证据",
      step: number(stopResponse.step),
      content: String(stopResponse.content || ""),
      response: stopResponse,
      sequence: stopResponse.sequence ?? 0,
    } : {
      id: "stop",
      kind: "stop",
      title: "停止证据",
      step: null,
      content: "",
      response: null,
      sequence: turnStages.length ? turnStages[turnStages.length - 1].lastSequence : question.sequence,
      missing: true,
    };

    const groups = checkGroups(record?.checks || []);
    const statusCounts = { PASS: 0, FAIL: 0, SKIP: 0, UNKNOWN: 0 };
    groups.forEach((group) => Object.keys(statusCounts).forEach((key) => { statusCounts[key] += group.summary[key]; }));
    const result = {
      id: "result",
      kind: "result",
      title: "结果验收",
      passed: record?.passed === true,
      status: record?.status || null,
      checks: record?.checks || [],
      groups,
      statusCounts,
      sequence: stop.sequence,
    };

    const stages = [question, ...turnStages, stop, result];
    const stageIndex = new Map(stages.map((stage, index) => [stage.id, index]));
    const strongEdges = [];
    const links = [];
    for (let index = 0; index < stages.length - 1; index += 1) {
      const from = stages[index];
      const to = stages[index + 1];
      if (from.kind !== "turn" || to.kind !== "turn") {
        links.push({ from: from.id, to: to.id, strong: false, kind: "structure", reason: "结构性顺序，不是字段因果证据。" });
        continue;
      }
      const nextCall = to.calls[0] || null;
      const nextStart = nextCall?.startLine ?? null;
      let strong = false;
      let reason = "缺少可比较字段。";
      if (!from.observation) reason = "上一条 turn 没有关联到 tool_result。";
      else if (from.hasMore !== true) reason = `上一条 observation 的 has_more=${from.hasMore === false ? "false" : "未记录"}，不满足 true。`;
      else if (from.nextStartLine === null) reason = "上一条 observation 没有记录 next_start_line。";
      else if (nextStart === null) reason = "下一次调用没有记录 start_line。";
      else if (from.nextStartLine !== nextStart) reason = `next_start_line=${from.nextStartLine}，下一次 start_line=${nextStart}，字段不相等。`;
      else if (from.filePath && nextCall?.filePath && from.filePath !== nextCall.filePath) reason = `文件不同：${from.filePath} → ${nextCall.filePath}。`;
      else if (from.tool && nextCall?.call?.tool && from.tool !== nextCall.call.tool) reason = `工具不同：${from.tool} → ${nextCall.call.tool}。`;
      else strong = true;

      const link = {
        from: from.id,
        to: to.id,
        strong,
        kind: "field-match",
        field: strong ? "next_start_line" : null,
        observationValue: strong ? from.nextStartLine : (from.nextStartLine ?? null),
        callValue: strong ? nextStart : (nextStart ?? null),
        fromStep: from.step,
        toStep: to.step,
        filePath: from.filePath || nextCall?.filePath || null,
        reason: strong
          ? `Observation.next_start_line=${from.nextStartLine}，下一次 tool_call.start_line=${nextStart}；字段相等，内部动机未记录。`
          : reason,
      };
      links.push(link);
      if (strong) strongEdges.push(link);
    }

    return {
      stages,
      links,
      strongEdges,
      turns: turnStages,
      question,
      stop,
      result,
      stageIndex,
      recordId: record?.id || null,
    };
  }

  function paginationSignature(stage) {
    return `${stage?.filePath || ""}|${stage?.tool || ""}`;
  }

  function episodeDetail(stages) {
    const first = stages[0];
    const last = stages[stages.length - 1];
    const ranges = stages.map((stage) => stage.returnedRange).filter(Boolean);
    const rangeText = ranges.length > 1 ? `${ranges[0]} → ${ranges[ranges.length - 1]}` : (ranges[0] || "范围未记录");
    const matches = Math.max(0, stages.length - 1);
    const stepRange = `S${first.step}–S${last.step}`;
    return `${stepRange} 连续分页：${first.tool || "工具"} 读取 ${first.filePath || "文件"}，第 ${rangeText} 行；${matches} 条 observation→下一次调用字段匹配。内部动机未记录。`;
  }

  function collapseEpisodes(chain) {
    const stages = Array.isArray(chain?.stages) ? chain.stages : [];
    const question = stages.find((stage) => stage.kind === "question") || null;
    const stop = stages.find((stage) => stage.kind === "stop") || null;
    const result = stages.find((stage) => stage.kind === "result") || null;
    const turns = stages.filter((stage) => stage.kind === "turn");
    const strongPairs = new Set((chain?.strongEdges || []).map((edge) => `${edge.from}->${edge.to}`));
    const episodes = [];
    if (question) episodes.push({ id: "episode-question", kind: "question", title: "起点 · 任务为什么要这样跑", stages: [question] });

    const runs = [];
    let current = [];
    turns.forEach((stage) => {
      if (!current.length) {
        current = [stage];
        return;
      }
      const previous = current[current.length - 1];
      const continuous = strongPairs.has(`${previous.id}->${stage.id}`)
        && paginationSignature(previous) === paginationSignature(stage)
        && stage.startLine !== null;
      if (continuous) current.push(stage);
      else {
        runs.push(current);
        current = [stage];
      }
    });
    if (current.length) runs.push(current);

    runs.forEach((run, index) => {
      if (run.length > 1) {
        episodes.push({
          id: `episode-continuation-${index + 1}`,
          kind: "continuation",
          title: `分页接力 · ${run[0].title}–${run[run.length - 1].title.replace(/^Step\s*/, "S")}`,
          stages: run,
          firstStep: run[0].step,
          lastStep: run[run.length - 1].step,
          detail: episodeDetail(run),
        });
      } else {
        const stage = run[0];
        episodes.push({
          id: `episode-tool-${stage.step}`,
          kind: "tool",
          title: stage.title,
          stages: run,
          firstStep: stage.step,
          lastStep: stage.step,
          detail: stage.detail,
        });
      }
    });

    if (stop) episodes.push({ id: "episode-stop", kind: "stop", title: "停止 · 无 tool_calls 的响应", stages: [stop], firstStep: stop.step, lastStep: stop.step });
    if (result) episodes.push({ id: "episode-result", kind: "result", title: "验收 · checks 给出可复核结论", stages: [result] });
    return episodes;
  }

  function summarizeExperiment(record, contract) {
    const fixture = fixtureSummary(contract);
    const groups = checkGroups(record?.checks || []);
    const chain = buildCausalChain(record, contract);
    const episodes = collapseEpisodes(chain);
    const counts = { PASS: 0, FAIL: 0, SKIP: 0, UNKNOWN: 0 };
    groups.forEach((group) => Object.keys(counts).forEach((key) => { counts[key] += group.summary[key]; }));
    const toolNames = [...new Set(chain.turns.map((stage) => stage.tool).filter(Boolean))];
    const continuation = episodes.find((episode) => episode.kind === "continuation") || null;
    const stop = chain.stop;
    const constraints = groups.find((group) => group.id === "constraint")?.checks || [];
    const acceptance = groups.find((group) => group.id === "acceptance")?.checks || [];
    const mechanisms = [
      {
        title: "工具契约",
        detail: toolNames.length
          ? `本次 Trace 中出现的工具是 ${toolNames.join("、")}；参数与结果都能回放到真实事件。`
          : "本次 Trace 没有 tool_call。页面不会补造工具能力。",
      },
      {
        title: "Observation",
        detail: chain.strongEdges.length
          ? `${chain.strongEdges.length} 条 Observation 字段与下一次调用参数相等；这是可观察接力，不是内部动机。`
          : "没有找到 next_start_line 与下一次 start_line 的强字段匹配；只能按普通步骤阅读。",
      },
      {
        title: "Context 延续",
        detail: (record?.events || []).some((event) => event.event === "model_request" && Number(event.tool_observation_chars) > 0)
          ? "至少一次 model_request 记录了 tool observation 字符数，说明工具结果进入了后续上下文。"
          : "报告没有记录 tool observation 进入后续 model_request 的字符证据。",
      },
      {
        title: "停止条件",
        detail: stop?.response && !(stop.response.tool_calls || []).length
          ? "最后一条 model_response 不含 tool_calls，Trace 进入停止分支；这是结构证据，不是模型内心解释。"
          : "报告没有记录无 tool_calls 的最终响应，不能声称 Loop 已正常停止。",
      },
      {
        title: "结果验收",
        detail: `checks 汇总为 PASS ${counts.PASS}、FAIL ${counts.FAIL}、SKIP ${counts.SKIP}、UNKNOWN ${counts.UNKNOWN}；最终答案和过程约束分开判断。`,
      },
    ];
    const takeaways = [
      {
        title: "工具调用要有契约，不只看名字",
        body: toolNames.length
          ? `${toolNames.join("、")} 的调用、参数和 observation 都能定位到事件；工具“可用”不等于这次真的用对。`
          : "本次没有工具调用；不能从最终文本反推工具能力。",
      },
      {
        title: "Observation 可以直接约束下一次参数",
        body: chain.strongEdges.length
          ? `本次有 ${chain.strongEdges.length} 处字段相等：上一条 observation 给出 next_start_line，下一次调用使用相同 start_line。内部动机未记录。`
          : "本次没有形成强字段匹配；更稳妥的说法是“路径发生变化”，而不是“模型因为某个字段而改变”。",
      },
      {
        title: "连续分页应聚成一个 episode",
        body: continuation
          ? `S${continuation.firstStep}–S${continuation.lastStep} 是同一个分页任务，保留 ${continuation.stages.length} 个真实 step 作为展开证据，默认只占一个叙事段。`
          : "没有识别到连续分页接力；不要为了故事流畅把普通轮次强行合并。",
      },
      {
        title: "停止条件是 Trace 结构，不是措辞",
        body: stop?.response && !(stop.response.tool_calls || []).length
          ? "最后一条 model_response 的 tool_calls 为空，才是本次可复核的停止证据。"
          : "没有无 tool_calls 响应时，不能把“看起来完成”当成 Loop 已停止。",
      },
      {
        title: "PASS、SKIP 和 UNKNOWN 必须分开",
        body: counts.SKIP
          ? `本次有 ${counts.SKIP} 项 SKIP：策略关闭或证据不足时没有验证能力，不能画成绿色 PASS。`
          : "如果 check 缺少 passed 或明确 skipped，页面会显示 UNKNOWN/SKIP，而不是自动补成 PASS。",
      },
    ];
    return {
      hasContract: fixture.hasContract,
      question: contract?.prompt || null,
      fixture,
      groups,
      counts,
      chain,
      episodes,
      mechanisms,
      takeaways,
      constraints,
      acceptance,
      toolNames,
      continuation,
      outcome: record?.passed === true ? "PASS" : (record?.passed === false ? "FAIL" : "UNKNOWN"),
      boundary: "这是单次 Live Eval 快照。字段一致只能说明可观察关联；单次 A/B 差异不能证明压缩策略导致结果变化。",
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
    buildCausalChain,
    checkGroups,
    classifyCheck,
    collapseEpisodes,
    findFirstDivergence,
    firstCheckDifference,
    fixtureSummary,
    groupRounds,
    loopJourney,
    loopNodeForEvent,
    modelRequestSummary,
    observationSummary,
    outcomeText,
    parseArguments,
    parseObservationMetadata,
    summarizeExperiment,
    toolPath,
  };
});
