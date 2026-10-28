"use strict";

const state = {
  data: null,
  view: "anatomy",
  runId: null,
  taskId: null,
  eventIndex: 0,
  compareA: null,
  compareB: null,
  playing: false,
  timer: null,
};

const $ = (id) => document.getElementById(id);
const EVENT_LABELS = {
  run_started: "运行开始",
  model_request: "准备模型请求",
  model_response: "模型返回响应",
  tool_call: "发起工具调用",
  tool_result: "工具返回 observation",
  approval_denied: "审批拒绝",
  invalid_tool_arguments: "工具参数无效",
  history_compaction: "历史压缩检查",
  compaction_model_request: "摘要模型请求",
  compaction_model_response: "摘要模型响应",
  compaction_model_error: "摘要模型异常",
  model_error: "主模型异常",
  run_finished: "运行结束",
};
const FLOW_NODES = [
  ["request", "01", "Model Request"],
  ["response", "02", "Model Response"],
  ["approval", "03", "Approval?"],
  ["tool", "04", "Tool"],
  ["observation", "05", "Observation"],
  ["compaction", "06", "Compaction"],
  ["finish", "07", "Finish"],
];
const EVENT_FLOW = {
  run_started: "request",
  model_request: "request",
  compaction_model_request: "compaction",
  model_response: "response",
  compaction_model_response: "compaction",
  compaction_model_error: "compaction",
  approval_denied: "approval",
  tool_call: "tool",
  invalid_tool_arguments: "tool",
  tool_result: "observation",
  history_compaction: "compaction",
  model_error: "finish",
  run_finished: "finish",
};
const MODULE_STYLE = {
  model: ["M", "#486fa8", "#e8eef8"],
  loop: ["L", "#147d73", "#e0f1ec"],
  tools: ["T", "#b77a13", "#fff1ce"],
  approval: ["A", "#db6b4f", "#fbe9e2"],
  context: ["C", "#7762a8", "#eee9f7"],
  compaction: ["H", "#7762a8", "#eee9f7"],
  trace: ["E", "#147d73", "#e0f1ec"],
  eval: ["V", "#486fa8", "#e8eef8"],
};
const RISK_LABELS = { read: "只读", write: "写入 · 需审批", execute: "执行 · 需审批" };

function h(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function clear(element) {
  element.replaceChildren();
  return element;
}

function add(parent, ...children) {
  children.filter(Boolean).forEach((child) => parent.append(child));
  return parent;
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "未记录";
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value) {
  return value === null || value === undefined ? "未记录" : `${(Number(value) * 100).toFixed(2)}%`;
}

function formatDuration(value) {
  if (value === null || value === undefined) return "未记录";
  const seconds = Number(value);
  return seconds >= 60 ? `${(seconds / 60).toFixed(2)} min` : `${seconds.toFixed(2)} s`;
}

function pretty(value) {
  return JSON.stringify(value, null, 2) ?? "null";
}

function currentRun() {
  return state.data?.runs.find((run) => run.id === state.runId) || null;
}

function currentRecord() {
  const run = currentRun();
  return run?.records.find((record) => record.id === state.taskId) || run?.records[0] || null;
}

function runById(id) {
  return state.data?.runs.find((run) => run.id === id) || null;
}

function sourceLink(source) {
  if (!source || !source.path) return h("span", "muted", "源码位置未记录");
  const label = `${source.path}${source.line ? `:${source.line}` : ""}`;
  if (source.path === "unknown" || source.path.startsWith("/")) {
    return h("code", "source-link", label);
  }
  const link = h("a", "source-link", `↗ ${label}`);
  link.href = `../${source.path}${source.line ? `#L${source.line}` : ""}`;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

function statusBadge(passed, status) {
  const isPass = passed === true;
  const text = passed === null || passed === undefined ? (status || "未记录") : (isPass ? "PASS" : "FAIL");
  return h("span", `status-badge ${isPass ? "status-pass" : "status-fail"}`, text);
}

function fillRunSelect(select, selected) {
  clear(select);
  (state.data?.runs || []).forEach((run) => {
    const option = h("option", "", `${run.label} · ${run.model || "unknown model"}`);
    option.value = run.id;
    option.selected = run.id === selected;
    select.append(option);
  });
}

function switchView(view) {
  if (state.view === view) return;
  stopPlayback();
  state.view = view;
  document.querySelectorAll(".view-tab").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.hidden = panel.id !== `view-${view}`;
  });
  renderView(view);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderView(view) {
  if (!state.data) return;
  if (view === "anatomy") renderAnatomy();
  if (view === "replay") renderReplay();
  if (view === "compare") renderCompare();
}

function renderAll() {
  fillRunSelect($("global-run-select"), state.runId);
  renderAnatomy();
  renderReplay();
  renderCompare();
}

function toolUsage(run) {
  const usage = {};
  const ensure = (name) => usage[name] ||= { calls: 0, results: 0, errors: 0, denied: 0, duration: 0, entries: [] };
  (run?.records || []).forEach((record) => {
    const results = new Map();
    (record.events || []).forEach((event) => {
      if (event.event === "tool_result" && event.call_id) {
        results.set(`${event.call_id}:${event.tool}`, event);
      }
    });
    (record.events || []).forEach((event) => {
      if (!event.tool) return;
      const bucket = ensure(event.tool);
      if (event.event === "tool_call") {
        bucket.calls += 1;
        const result = results.get(`${event.call_id}:${event.tool}`) || null;
        bucket.entries.push({ record, event, result });
      }
      if (event.event === "tool_result") {
        bucket.results += 1;
        if (!event.ok) bucket.errors += 1;
        bucket.duration += Number(event.duration_ms || 0);
      }
      if (event.event === "approval_denied") bucket.denied += 1;
    });
  });
  return usage;
}

function renderAnatomy() {
  const { catalog, runs } = state.data;
  const run = currentRun();
  const summary = run?.summary || {};
  const stats = [
    [catalog.modules.length, "真实核心模块"],
    [catalog.tools.length, "内置工具 · 7/7 覆盖"],
    [runs.length, "已导入实验运行"],
    [`${summary.passed ?? "—"}/${summary.total ?? "—"}`, "当前运行通过 · 单次快照"],
  ];
  const statRoot = clear($("anatomy-stats"));
  stats.forEach(([value, label]) => {
    const item = h("div", "stat-item");
    add(item, h("strong", "", value), h("span", "", label));
    statRoot.append(item);
  });

  const moduleRoot = clear($("module-grid"));
  catalog.modules.forEach((module) => {
    const [abbr, color, soft] = MODULE_STYLE[module.id] || ["·", "#147d73", "#e0f1ec"];
    const card = h("article", "module-card");
    card.style.setProperty("--module-color", color);
    card.style.setProperty("--module-soft", soft);
    const top = h("div", "module-top");
    add(top, h("span", "module-icon", abbr), h("span", "module-kind", module.kind));
    const connections = h("div", "connection-list");
    (module.connects_to || []).forEach((target) => connections.append(h("span", "connection-chip", `→ ${target}`)));
    add(card, top, h("h3", "", module.name), h("p", "", module.summary), connections, sourceLink(module.source));
    moduleRoot.append(card);
  });

  renderTools();
}

function renderTools() {
  if (!state.data) return;
  const query = $("tool-search").value.trim().toLowerCase();
  const risk = $("risk-filter").value;
  const usage = toolUsage(currentRun());
  const root = clear($("tool-grid"));
  const tools = state.data.catalog.tools.filter((tool) => {
    const matchesRisk = risk === "all" || tool.risk === risk;
    const haystack = `${tool.name} ${tool.description}`.toLowerCase();
    return matchesRisk && (!query || haystack.includes(query));
  });
  if (!tools.length) {
    root.append(h("div", "no-data", "没有符合筛选条件的工具。"));
    return;
  }
  tools.forEach((tool) => {
    const stats = usage[tool.name] || { calls: 0, errors: 0, denied: 0 };
    const card = h("button", "tool-card");
    card.type = "button";
    card.setAttribute("aria-label", `查看工具 ${tool.name}`);
    const top = h("div", "tool-card-top");
    add(top, h("h3", "", tool.name), h("span", `risk-badge risk-${tool.risk}`, RISK_LABELS[tool.risk] || tool.risk));
    const meta = h("div", "tool-meta");
    add(meta, h("span", "", `本次调用 ${stats.calls}`), h("span", "", `错误 ${stats.errors}`), h("span", "", `拒绝 ${stats.denied}`));
    const footer = h("div", "tool-card-footer");
    add(footer, h("code", "", `${tool.source.path}:${tool.source.line || "?"}`), h("span", "", "拆解 →"));
    add(card, top, h("p", "", tool.description), meta, footer);
    card.addEventListener("click", () => openToolDialog(tool.name));
    root.append(card);
  });
}

function exampleArguments(tool, firstEntry) {
  if (firstEntry) return firstEntry.event.arguments;
  const example = {};
  Object.entries(tool.parameters?.properties || {}).forEach(([name, schema]) => {
    if (schema.type === "integer" || schema.type === "number") example[name] = 1;
    else if (schema.type === "boolean") example[name] = true;
    else if (schema.type === "array") example[name] = [];
    else if (schema.type === "object") example[name] = {};
    else example[name] = `<${schema.type || "value"}>`;
  });
  return example;
}

function openToolDialog(toolName) {
  const tool = state.data.catalog.tools.find((item) => item.name === toolName);
  if (!tool) return;
  const usage = toolUsage(currentRun())[toolName] || { entries: [] };
  const dialog = $("tool-dialog");
  const root = clear($("tool-dialog-content"));
  const inner = h("div", "dialog-inner");
  const close = h("button", "dialog-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "关闭工具详情");
  close.addEventListener("click", () => dialog.close());
  add(inner, close, h("p", "eyebrow", "TOOL CONTRACT"), h("h2", "dialog-title", tool.name));
  inner.append(h("span", `risk-badge risk-${tool.risk}`, RISK_LABELS[tool.risk] || tool.risk));
  add(inner, h("p", "dialog-description", tool.description));

  const contract = h("section", "dialog-section");
  add(contract, h("h3", "", "在 Agent 中的位置"), h("div", "contract-box", tool.architecture));
  const sources = h("div", "dialog-section");
  add(sources, sourceLink(tool.source), h("br", ""), sourceLink(tool.registry_source));
  contract.append(sources);
  inner.append(contract);

  const schema = h("section", "dialog-section");
  add(schema, h("h3", "", "JSON Schema"), h("pre", "", pretty(tool.parameters)));
  inner.append(schema);
  const example = h("section", "dialog-section");
  add(example, h("h3", "", usage.entries.length ? "第一次真实调用参数" : "按 Schema 生成的参数结构（非真实调用）"), h("pre", "", pretty(exampleArguments(tool, usage.entries[0]))));
  inner.append(example);

  const calls = h("section", "dialog-section");
  calls.append(h("h3", "", `当前运行真实调用 · ${usage.entries.length}`));
  if (!usage.entries.length) {
    calls.append(h("div", "no-data", "当前运行没有调用此工具。Schema 来自 registry，不伪造调用。"));
  } else {
    const list = h("div", "call-list");
    usage.entries.slice(0, 30).forEach((entry) => {
      const button = h("button", "call-link");
      button.type = "button";
      const resultText = entry.result ? (entry.result.ok ? "成功" : "失败") : "无结果事件";
      add(button, h("code", "", `${entry.record.id} · step ${entry.event.step}`), h("span", "", `${resultText} →`));
      button.addEventListener("click", () => {
        state.taskId = entry.record.id;
        state.eventIndex = entry.event.sequence;
        dialog.close();
        switchView("replay");
        renderReplay();
      });
      list.append(button);
    });
    calls.append(list);
  }
  inner.append(calls);
  root.append(inner);
  dialog.showModal();
}

function eventNarrative(event) {
  const tool = event.tool ? ` · ${event.tool}` : "";
  switch (event.event) {
    case "run_started": return `最多 ${event.max_steps ?? "?"} 步 · ${event.compaction_strategy || "off"}`;
    case "model_request": return `上下文 ${formatNumber(event.context_chars)} chars · ${event.message_count ?? "?"} messages`;
    case "model_response": return event.tool_calls?.length ? `${event.tool_calls.length} 个 tool call` : (event.content || "无文本响应").slice(0, 90);
    case "tool_call": return `调用${tool}`;
    case "tool_result": return `${event.ok ? "成功" : "失败"}${tool} · ${formatNumber(event.duration_ms, 2)} ms`;
    case "approval_denied": return `未批准${tool}`;
    case "invalid_tool_arguments": return `参数错误${tool}`;
    case "history_compaction": return event.compacted ? `已压缩 · ${event.effective_strategy || "unknown"} · evidence ${event.evidence_count ?? 0}` : `未压缩 · ${event.reason || "unknown"}`;
    case "run_finished": return `${event.status || "unknown"} · ${event.steps ?? "?"} steps`;
    case "model_error": return event.error || "模型异常";
    default: return EVENT_LABELS[event.event] || "结构化事件";
  }
}

function renderLoopFlow(events) {
  const root = clear($("loop-flow"));
  const activeEvent = events[state.eventIndex] || {};
  const activeNode = EVENT_FLOW[activeEvent.event];
  const completed = new Set(events.slice(0, state.eventIndex).map((event) => EVENT_FLOW[event.event]).filter(Boolean));
  FLOW_NODES.forEach(([id, number, label]) => {
    const classes = ["flow-node"];
    if (completed.has(id)) classes.push("completed");
    if (activeNode === id) classes.push("active");
    const node = h("div", classes.join(" "));
    add(node, h("span", "", number), h("strong", "", label));
    root.append(node);
  });
}

function renderEventDetail(event) {
  const root = clear($("event-detail"));
  if (!event) {
    root.append(h("div", "no-data", "这个任务没有事件。"));
    return;
  }
  const header = h("div", "detail-header");
  add(header, h("p", "eyebrow", `EVENT ${String(event.sequence).padStart(2, "0")} · ${event.timestamp || "NO TIMESTAMP"}`), h("h2", "", event.event), h("p", "", eventNarrative(event)));
  root.append(header);

  const metrics = [
    ["Step", event.step],
    ["Call ID", event.call_id],
    ["ID 来源", event.call_id_source],
    ["Prompt tokens", event.usage?.prompt_tokens],
    ["Completion tokens", event.usage?.completion_tokens],
    ["Context chars", event.context_chars],
    ["Duration", event.duration_ms !== undefined ? `${event.duration_ms} ms` : null],
    ["Tool OK", event.ok !== undefined ? String(event.ok) : null],
    ["Compacted", event.compacted !== undefined ? String(event.compacted) : null],
    ["Fallback", event.fallback_reason],
    ["Status", event.status],
  ].filter(([, value]) => value !== null && value !== undefined);
  const metricGrid = h("div", "detail-grid");
  metrics.forEach(([label, value]) => {
    const item = h("div", "detail-metric");
    add(item, h("span", "", label), h("strong", "", value));
    metricGrid.append(item);
  });
  root.append(metricGrid);

  const payloads = [];
  if (event.content) payloads.push(["内容 / observation", event.content]);
  if (event.arguments !== undefined) payloads.push(["调用参数", typeof event.arguments === "string" ? event.arguments : pretty(event.arguments)]);
  if (event.tool_calls?.length) payloads.push(["模型生成的 tool calls", pretty(event.tool_calls)]);
  if (event.error) payloads.push(["错误", event.error]);
  payloads.push(["完整事件 JSON", pretty(event)]);
  payloads.forEach(([label, value]) => {
    const block = h("section", "payload-block");
    add(block, h("h3", "", label), h("pre", "", value));
    root.append(block);
  });
}

function renderTurns(record) {
  const root = clear($("turn-chart"));
  const turns = record?.context?.turns || [];
  if (!turns.length) {
    root.append(h("div", "no-data", "报告没有逐轮 context 数据。"));
    return;
  }
  const legend = h("div", "chart-legend");
  add(legend, h("span", "", "● Prompt tokens"), h("span", "", "● Context chars（各自归一化）"));
  legend.children[0].style.color = "#486fa8";
  legend.children[1].style.color = "#147d73";
  root.append(legend);
  const maxTokens = Math.max(1, ...turns.map((turn) => Number(turn.input_tokens || 0)));
  const maxChars = Math.max(1, ...turns.map((turn) => Number(turn.context_chars || 0)));
  turns.forEach((turn) => {
    const row = h("div", "turn-row");
    row.title = `Step ${turn.step}: prompt ${turn.input_tokens ?? "未记录"} tokens, context ${turn.context_chars ?? "未记录"} chars`;
    const bars = h("div", "turn-bars");
    const tokenBar = h("div", "turn-bar tokens");
    const tokenFill = h("i");
    tokenFill.style.width = `${Number(turn.input_tokens || 0) / maxTokens * 100}%`;
    tokenBar.append(tokenFill);
    const charBar = h("div", "turn-bar chars");
    const charFill = h("i");
    charFill.style.width = `${Number(turn.context_chars || 0) / maxChars * 100}%`;
    charBar.append(charFill);
    add(bars, tokenBar, charBar);
    add(row, h("strong", "", `Step ${turn.step}`), bars, h("span", "turn-values", `${formatNumber(turn.input_tokens)} tk\n${formatNumber(turn.context_chars)} ch`));
    root.append(row);
  });
}

function renderChecks(element, checks) {
  const root = clear(element);
  if (!checks?.length) {
    root.append(h("div", "no-data", "没有 checks 记录。"));
    return;
  }
  checks.forEach((check) => {
    const item = h("div", `check-item ${check.passed ? "" : "failed"}`);
    add(item, h("span", "check-icon", check.passed ? "✓" : "×"), h("code", "", check.check));
    root.append(item);
  });
}

function renderReplay() {
  const run = currentRun();
  const taskSelect = clear($("task-select"));
  (run?.records || []).forEach((record) => {
    const option = h("option", "", `${record.passed ? "✓" : "×"} ${record.id}`);
    option.value = record.id;
    option.selected = record.id === currentRecord()?.id;
    taskSelect.append(option);
  });
  const record = currentRecord();
  if (!record) {
    clear($("task-summary")).append(h("div", "no-data", "这次运行没有任务记录。"));
    return;
  }
  state.taskId = record.id;
  state.eventIndex = Math.max(0, Math.min(state.eventIndex, (record.events || []).length - 1));

  const summary = clear($("task-summary"));
  add(summary, h("strong", "", record.id), statusBadge(record.passed, record.status), h("span", "", `group: ${record.group || "未记录"}`), h("span", "", `${record.steps ?? "?"} steps`), h("span", "", formatDuration(record.duration_seconds)), h("span", "", `${record.tool_errors ?? 0} tool errors`));

  const events = record.events || [];
  renderLoopFlow(events);
  renderEventDetail(events[state.eventIndex]);
  renderTurns(record);
  renderChecks($("replay-checks"), record.checks);
  $("event-count").textContent = `${events.length} events`;
  $("event-position").textContent = events.length ? `事件 ${state.eventIndex + 1} / ${events.length} · Step ${events[state.eventIndex].step ?? "—"}` : "0 events";
  $("prev-event").disabled = state.eventIndex <= 0;
  $("next-event").disabled = state.eventIndex >= events.length - 1;
  $("play-events").disabled = events.length < 2;
  $("play-events").textContent = state.playing ? "Ⅱ 暂停" : "▶ 播放";

  const timeline = clear($("event-timeline"));
  events.forEach((event, index) => {
    const button = h("button", `event-item ${index === state.eventIndex ? "active" : ""}`);
    button.type = "button";
    const copy = h("span", "event-copy");
    add(copy, h("strong", "", event.event), h("span", "", eventNarrative(event)));
    add(button, h("span", "event-sequence", String(index).padStart(2, "0")), copy, h("span", "event-step", event.step ? `S${event.step}` : "—"));
    button.addEventListener("click", () => {
      stopPlayback();
      state.eventIndex = index;
      renderReplay();
    });
    timeline.append(button);
  });
  const active = timeline.querySelector(".event-item.active");
  if (active) timeline.scrollTop = Math.max(0, active.offsetTop - timeline.clientHeight / 2);
}

function stopPlayback() {
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
  state.playing = false;
  if (state.data) $("play-events").textContent = "▶ 播放";
}

function togglePlayback() {
  if (state.playing) {
    stopPlayback();
    return;
  }
  const events = currentRecord()?.events || [];
  if (events.length < 2) return;
  if (state.eventIndex >= events.length - 1) state.eventIndex = 0;
  state.playing = true;
  renderReplay();
  state.timer = window.setInterval(() => {
    const currentEvents = currentRecord()?.events || [];
    if (state.eventIndex >= currentEvents.length - 1) {
      stopPlayback();
      renderReplay();
      return;
    }
    state.eventIndex += 1;
    renderReplay();
  }, 950);
}

function flattenConfig(run) {
  const compaction = run?.config?.compaction || {};
  return {
    provider: run?.provider,
    model: run?.model,
    code_revision: run?.code_revision || "未记录",
    context_window_tokens: run?.config?.context_window_tokens,
    max_observation_chars: run?.config?.max_observation_chars,
    compaction_strategy: compaction.strategy,
    compaction_trigger_tokens: compaction.trigger_tokens,
    compaction_keep_recent: compaction.keep_recent_messages,
    compaction_max_summary_chars: compaction.max_summary_chars,
  };
}

function ensureCompareRuns() {
  const runs = state.data.runs;
  if (!runById(state.compareA)) state.compareA = runs[0]?.id || null;
  if (!runById(state.compareB)) state.compareB = runs[1]?.id || runs[0]?.id || null;
  if (runs.length > 1 && state.compareA === state.compareB) {
    state.compareB = runs.find((run) => run.id !== state.compareA)?.id || state.compareB;
  }
}

function metricDefinitions() {
  return [
    { label: "任务通过", value: (run) => run.summary.passed, display: (run) => `${run.summary.passed ?? "—"}/${run.summary.total ?? "—"} · ${formatPercent(run.summary.success_rate)}`, delta: (a, b) => `${((b.summary.success_rate || 0) - (a.summary.success_rate || 0)) * 100 >= 0 ? "+" : ""}${(((b.summary.success_rate || 0) - (a.summary.success_rate || 0)) * 100).toFixed(2)} 个百分点` },
    { label: "总模型 Token", key: "total_model_tokens", fallback: "total_tokens", digits: 0 },
    { label: "总耗时", key: "duration_seconds", displayValue: formatDuration, digits: 2, suffix: " s" },
    { label: "平均模型步数", key: "average_steps", digits: 2 },
    { label: "平均峰值 prompt Token", key: "average_peak_prompt_tokens", digits: 2 },
    { label: "压缩 / 回退", value: (run) => run.summary.total_compactions, display: (run) => `${formatNumber(run.summary.total_compactions)} / ${formatNumber(run.summary.total_compaction_fallbacks)}`, delta: (a, b) => `压缩 B−A：${formatNumber((b.summary.total_compactions || 0) - (a.summary.total_compactions || 0))}；回退 B−A：${formatNumber((b.summary.total_compaction_fallbacks || 0) - (a.summary.total_compaction_fallbacks || 0))}` },
  ];
}

function metricValue(run, definition) {
  if (definition.value) return definition.value(run);
  return run.summary[definition.key] ?? run.summary[definition.fallback];
}

function metricDisplay(run, definition) {
  if (definition.display) return definition.display(run);
  const value = metricValue(run, definition);
  if (definition.displayValue) return definition.displayValue(value);
  return formatNumber(value, definition.digits || 0);
}

function renderMetricComparison(a, b) {
  const root = clear($("metric-comparison"));
  metricDefinitions().forEach((definition) => {
    const card = h("article", "metric-card");
    card.append(h("h3", "", definition.label));
    const values = h("div", "metric-values");
    [["A", a, "run-a"], ["B", b, "run-b"]].forEach(([letter, run, className]) => {
      const item = h("div", "metric-value");
      add(item, h("span", className, `RUN ${letter} · ${run.label}`), h("strong", "", metricDisplay(run, definition)));
      values.append(item);
    });
    card.append(values);
    let delta;
    if (definition.delta) delta = definition.delta(a, b);
    else {
      const aValue = Number(metricValue(a, definition) || 0);
      const bValue = Number(metricValue(b, definition) || 0);
      const difference = bValue - aValue;
      delta = `B − A = ${difference >= 0 ? "+" : ""}${formatNumber(difference, definition.digits || 0)}${definition.suffix || ""}`;
    }
    card.append(h("div", "metric-delta", delta));
    root.append(card);
  });
}

function renderConfigComparison(a, b) {
  const root = clear($("config-comparison"));
  const aConfig = flattenConfig(a);
  const bConfig = flattenConfig(b);
  const table = h("table", "data-table");
  const header = h("tr");
  add(header, h("th", "", "参数"), h("th", "", `A · ${a.label}`), h("th", "", `B · ${b.label}`));
  const thead = h("thead"); thead.append(header); table.append(thead);
  const body = h("tbody");
  Object.keys(aConfig).forEach((key) => {
    const different = pretty(aConfig[key]) !== pretty(bConfig[key]);
    const row = h("tr", different ? "diff-row" : "");
    add(row, h("td", "", key), h("td", "", aConfig[key] ?? "未记录"), h("td", "", bConfig[key] ?? "未记录"));
    body.append(row);
  });
  table.append(body); root.append(table);
}

function renderTokenComparison(a, b) {
  const root = clear($("token-comparison"));
  [a, b].forEach((run, index) => {
    const summary = run.summary;
    const mainInput = Number(summary.total_input_tokens || 0);
    const mainOutput = Number(summary.total_output_tokens || 0);
    const summaryInput = Math.max(0, Number(summary.total_model_input_tokens || 0) - mainInput);
    const summaryOutput = Math.max(0, Number(summary.total_model_output_tokens || 0) - mainOutput);
    const values = [mainInput, mainOutput, summaryInput, summaryOutput];
    const total = Math.max(1, values.reduce((sum, value) => sum + value, 0));
    const container = h("div", "token-run");
    const header = h("div", "token-run-header");
    add(header, h("strong", "", `${index === 0 ? "A" : "B"} · ${run.label}`), h("span", "", `${formatNumber(summary.total_model_tokens ?? summary.total_tokens)} tokens`));
    const stack = h("div", "token-stack");
    ["token-main-input", "token-main-output", "token-summary-input", "token-summary-output"].forEach((className, part) => {
      const segment = h("i", className);
      segment.style.width = `${values[part] / total * 100}%`;
      segment.title = `${formatNumber(values[part])} tokens`;
      stack.append(segment);
    });
    const legend = h("div", "token-legend");
    [
      ["主模型输入", mainInput, "token-main-input"], ["主模型输出", mainOutput, "token-main-output"],
      ["摘要输入", summaryInput, "token-summary-input"], ["摘要输出", summaryOutput, "token-summary-output"],
    ].forEach(([label, value, className]) => {
      const item = h("span", "", `${label} ${formatNumber(value)}`);
      const dot = h("i", className); item.prepend(dot); legend.append(item);
    });
    add(container, header, stack, legend); root.append(container);
  });
}

function jumpToRecord(runId, taskId) {
  state.runId = runId;
  state.taskId = taskId;
  state.eventIndex = 0;
  fillRunSelect($("global-run-select"), runId);
  switchView("replay");
  renderAnatomy();
  renderReplay();
}

function renderTaskComparison(a, b) {
  const root = clear($("task-comparison"));
  const aRecords = new Map(a.records.map((record) => [record.id, record]));
  const bRecords = new Map(b.records.map((record) => [record.id, record]));
  const ids = [...new Set([...aRecords.keys(), ...bRecords.keys()])];
  ids.forEach((id) => {
    const aRecord = aRecords.get(id);
    const bRecord = bRecords.get(id);
    const row = h("article", "task-row");
    const main = h("div", "task-row-main");
    const taskButton = h("button", "task-link", id);
    taskButton.type = "button";
    taskButton.addEventListener("click", () => jumpToRecord(a.id, id));
    main.append(taskButton);
    [[a, aRecord, "A"], [b, bRecord, "B"]].forEach(([run, record, side]) => {
      if (!record) { main.append(h("span", "muted", `${side} · 无任务`)); return; }
      const button = h("button", `status-badge ${record.passed ? "status-pass" : "status-fail"}`);
      button.type = "button";
      button.style.border = "0";
      button.textContent = `${side} · ${record.passed ? "PASS" : "FAIL"}`;
      button.title = `回放 ${run.label} / ${id}`;
      button.addEventListener("click", () => jumpToRecord(run.id, id));
      main.append(button);
    });
    row.append(main);
    const details = h("details", "task-checks");
    details.append(h("summary", "", "展开逐检查项"));
    const grids = h("div", "task-checks-grid");
    [[a, aRecord, "A"], [b, bRecord, "B"]].forEach(([run, record, side]) => {
      const column = h("div");
      column.append(h("p", "eyebrow", `${side} · ${run.label}`));
      const list = h("div", "check-list");
      renderChecks(list, record?.checks || []);
      column.append(list); grids.append(column);
    });
    details.append(grids); row.append(details); root.append(row);
  });
}

function renderCompare() {
  ensureCompareRuns();
  fillRunSelect($("compare-a"), state.compareA);
  fillRunSelect($("compare-b"), state.compareB);
  const a = runById(state.compareA);
  const b = runById(state.compareB);
  if (!a || !b) return;
  const context = clear($("compare-context"));
  [[a, "A"], [b, "B"]].forEach(([run, side]) => {
    context.append(h("span", "", `${side}: ${run.provider || "?"} / ${run.model || "?"} · N=${run.summary.total ?? run.records.length} · commit ${run.code_revision || "未记录"}`));
  });
  context.append(h("span", "", `导出于 ${state.data.generated_at}`));
  renderMetricComparison(a, b);
  renderConfigComparison(a, b);
  renderTokenComparison(a, b);
  renderTaskComparison(a, b);
}

function showEmpty() {
  $("empty-state").hidden = false;
  $("error-state").hidden = true;
  $("dashboard-content").hidden = true;
  document.querySelectorAll(".view-tab, #global-run-select").forEach((element) => { element.disabled = true; });
}

function showError(message) {
  $("empty-state").hidden = true;
  $("error-state").hidden = false;
  $("error-message").textContent = message;
  $("dashboard-content").hidden = true;
}

async function loadData() {
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (response.status === 404) { showEmpty(); return; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.schema_version !== 1 || !Array.isArray(data.runs) || !data.catalog) {
      throw new Error("数据 schema 不兼容，请使用当前 scripts/export_dashboard.py 重新导出。");
    }
    if (!data.runs.length) throw new Error("导出文件没有任何运行，请至少传入一份 Eval 报告。");
    state.data = data;
    state.runId = data.runs[0].id;
    state.taskId = data.runs[0].records[0]?.id || null;
    state.compareA = data.runs[0].id;
    state.compareB = data.runs[1]?.id || data.runs[0].id;
    $("empty-state").hidden = true;
    $("error-state").hidden = true;
    $("dashboard-content").hidden = false;
    document.querySelector(".local-badge").title = `生成于 ${data.generated_at} · ${data.data_classification}`;
    renderAll();
  } catch (error) {
    showError(`${error.message}。请检查 data.json，或重新运行导出命令。`);
  }
}

function bindEvents() {
  document.querySelectorAll(".view-tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  $("global-run-select").addEventListener("change", (event) => {
    stopPlayback();
    state.runId = event.target.value;
    state.taskId = currentRun()?.records[0]?.id || null;
    state.eventIndex = 0;
    renderAll();
  });
  $("tool-search").addEventListener("input", renderTools);
  $("risk-filter").addEventListener("change", renderTools);
  $("task-select").addEventListener("change", (event) => {
    stopPlayback(); state.taskId = event.target.value; state.eventIndex = 0; renderReplay();
  });
  $("prev-event").addEventListener("click", () => { stopPlayback(); state.eventIndex = Math.max(0, state.eventIndex - 1); renderReplay(); });
  $("next-event").addEventListener("click", () => { stopPlayback(); state.eventIndex += 1; renderReplay(); });
  $("play-events").addEventListener("click", togglePlayback);
  $("compare-a").addEventListener("change", (event) => { state.compareA = event.target.value; ensureCompareRuns(); renderCompare(); });
  $("compare-b").addEventListener("change", (event) => { state.compareB = event.target.value; ensureCompareRuns(); renderCompare(); });
  $("swap-runs").addEventListener("click", () => { [state.compareA, state.compareB] = [state.compareB, state.compareA]; renderCompare(); });
  $("tool-dialog").addEventListener("click", (event) => { if (event.target === $("tool-dialog")) $("tool-dialog").close(); });
  document.addEventListener("keydown", (event) => {
    if (state.view !== "replay" || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName) || $("tool-dialog").open) return;
    if (event.key === "ArrowLeft" && state.eventIndex > 0) { event.preventDefault(); stopPlayback(); state.eventIndex -= 1; renderReplay(); }
    if (event.key === "ArrowRight") { event.preventDefault(); stopPlayback(); state.eventIndex = Math.min((currentRecord()?.events.length || 1) - 1, state.eventIndex + 1); renderReplay(); }
  });
}

bindEvents();
loadData();
