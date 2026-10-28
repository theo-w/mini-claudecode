"use strict";

const Story = globalThis.AgentStory;

const state = {
  data: null,
  view: "story",
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
const NODE_LABELS = {
  start: "运行开始",
  context: "上下文进入模型",
  decision: "模型作出判断",
  tool: "工具分支",
  observation: "Observation 写回",
  compaction: "历史压缩检查",
  approval: "审批闸门",
  finish: "完成分支",
  error: "异常分支",
  evidence: "补充证据",
  idle: "暂无位置",
};
const BRANCH_LABELS = {
  tool: "工具回环",
  finish: "完成",
  error: "异常",
  continue: "待续",
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

function compactText(value, max = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "未记录";
  return text.length > max ? `${text.slice(0, max)}…` : text;
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

function recordById(run, id) {
  return run?.records.find((record) => record.id === id) || null;
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

const STATUS_STYLE = {
  PASS: { symbol: "✓", className: "status-pass" },
  FAIL: { symbol: "×", className: "status-fail" },
  SKIP: { symbol: "→", className: "status-skip" },
  UNKNOWN: { symbol: "?", className: "status-unknown" },
};

function normalizedStatus(passed, status) {
  if (passed === true) return "PASS";
  if (passed === false) return "FAIL";
  const value = String(status || "").toUpperCase();
  if (["SKIP", "SKIPPED"].includes(value)) return "SKIP";
  return "UNKNOWN";
}

function statusBadge(passed, status, prefix = "") {
  const key = normalizedStatus(passed, status);
  const style = STATUS_STYLE[key];
  return h("span", `status-badge ${style.className}`, `${prefix}${style.symbol} ${key}`);
}

function checkBadge(check, prefix = "") {
  const status = ["PASS", "FAIL", "SKIP", "UNKNOWN"].includes(check?.status)
    ? check.status
    : normalizedStatus(check?.passed, check?.status);
  const style = STATUS_STYLE[status];
  return h("span", `status-badge ${style.className}`, `${prefix}${style.symbol} ${status}`);
}

function fillRunSelect(select, selected) {
  if (!select) return;
  clear(select);
  (state.data?.runs || []).forEach((run) => {
    const option = h("option", "", `${run.label} · ${run.model || "unknown model"}`);
    option.value = run.id;
    option.selected = run.id === selected;
    select.append(option);
  });
}

function fillTaskSelect(select, run, selected) {
  if (!select) return;
  clear(select);
  (run?.records || []).forEach((record) => {
    const status = normalizedStatus(record.passed, record.status);
    const option = h("option", "", `${STATUS_STYLE[status].symbol} ${status} · ${record.id}`);
    option.value = record.id;
    option.selected = record.id === selected;
    select.append(option);
  });
}

function syncTaskSelects() {
  const run = currentRun();
  const record = currentRecord();
  fillTaskSelect($("story-task-select"), run, record?.id);
  fillTaskSelect($("task-select"), run, record?.id);
}

function switchView(view) {
  if (state.view !== view) stopPlayback();
  state.view = view;
  document.querySelectorAll(".view-tab").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.hidden = panel.id !== `view-${view}`;
  });
  renderView(view);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderView(view) {
  if (!state.data || !Story) return;
  if (view === "story") renderStory();
  if (view === "replay") renderReplay();
  if (view === "anatomy") renderAnatomy();
  if (view === "compare") renderCompare();
}

function renderAll() {
  fillRunSelect($("global-run-select"), state.runId);
  syncTaskSelects();
  renderStory();
  renderReplay();
  renderAnatomy();
  renderCompare();
}

function eventIndexForStep(record, step) {
  const events = record?.events || [];
  if (step === null || step === undefined) return 0;
  const grouped = Story.groupRounds(record);
  const round = grouped.rounds.find((item) => Number(item.step) === Number(step));
  const sequence = round?.events[0]?.sequence;
  if (sequence !== undefined) {
    const index = events.findIndex((event) => Number(event.sequence) === Number(sequence));
    if (index >= 0) return index;
  }
  const index = events.findIndex((event) => Number(event.step) === Number(step));
  return index >= 0 ? index : 0;
}

function eventIndexForCall(record, call) {
  const events = record?.events || [];
  const sequence = Number(call?.sequence);
  if (Number.isFinite(sequence)) {
    const exact = events.findIndex((event) => Number(event.sequence) === sequence && (
      event.event === "tool_call" || event.event === "model_response"
    ));
    if (exact >= 0) return exact;
  }
  if (call?.call_id) {
    const callIndex = events.findIndex((event) => event.event === "tool_call" && event.call_id === call.call_id);
    if (callIndex >= 0) return callIndex;
    const responseIndex = events.findIndex((event) => event.event === "model_response" && (event.tool_calls || []).some((item) => item.id === call.call_id));
    if (responseIndex >= 0) return responseIndex;
  }
  return eventIndexForStep(record, call?.step);
}

function jumpToRecord(runId, taskId, eventIndex = 0) {
  stopPlayback();
  state.runId = runId;
  state.taskId = taskId;
  state.eventIndex = Math.max(0, eventIndex);
  fillRunSelect($("global-run-select"), runId);
  syncTaskSelects();
  if (state.view === "replay") renderReplay();
  else switchView("replay");
}

function jumpToSequence(runId, taskId, sequence) {
  const run = runById(runId);
  const record = recordById(run, taskId);
  const index = (record?.events || []).findIndex((event) => Number(event.sequence) === Number(sequence));
  jumpToRecord(runId, taskId, index >= 0 ? index : 0);
}

function recordToolCounts(record) {
  const counts = {};
  Story.groupRounds(record).rounds.forEach((round) => {
    round.calls.forEach(({ call }) => {
      if (call.tool) counts[call.tool] = (counts[call.tool] || 0) + 1;
    });
  });
  return counts;
}

function toolUsage(run) {
  const usage = {};
  const ensure = (name) => usage[name] ||= { calls: 0, results: 0, errors: 0, denied: 0, duration: 0, entries: [] };
  (run?.records || []).forEach((record) => {
    const grouped = Story.groupRounds(record);
    grouped.rounds.forEach((round) => {
      round.calls.forEach(({ call, result }) => {
        if (!call.tool) return;
        const bucket = ensure(call.tool);
        bucket.calls += 1;
        bucket.entries.push({ record, event: call, result });
        if (result) {
          bucket.results += 1;
          if (!result.ok) bucket.errors += 1;
          bucket.duration += Number(result.duration_ms || 0);
        }
      });
      round.approvals.forEach((event) => {
        if (event.tool) ensure(event.tool).denied += 1;
      });
    });
  });
  return usage;
}

function renderStoryHero(record, grouped, path, summary) {
  const root = clear($("story-hero"));
  const outcome = summary.outcome.toLowerCase();
  const card = h("article", `lesson-hero-card lesson-hero-${outcome}`);

  const conclusion = h("div", "lesson-hero-conclusion");
  conclusion.append(h("p", "eyebrow", "本次实验结论"));
  const top = h("div", "lesson-hero-top");
  add(top, statusBadge(record.passed, record.status), h("code", "hero-task-id", record.id));
  conclusion.append(top);
  conclusion.append(h("h2", "", summary.outcome === "PASS"
    ? "路径完成了任务，但仍要分清 PASS 与 SKIP"
    : "先沿可观察路径定位差异，不猜模型动机"));
  conclusion.append(h("p", "lesson-hero-copy", `checks 汇总：PASS ${summary.counts.PASS} / FAIL ${summary.counts.FAIL} / SKIP ${summary.counts.SKIP} / UNKNOWN ${summary.counts.UNKNOWN}。通过结果不等于每一项机制都被验证。`));
  const meta = h("div", "hero-meta");
  add(meta,
    h("span", "", `group · ${record.group || "未记录"}`),
    h("span", "", `${record.steps ?? "?"} 个模型步`),
    h("span", "", formatDuration(record.duration_seconds)),
    h("span", "", `${(record.events || []).length} 条事件`));
  conclusion.append(meta);

  const stats = h("div", "lesson-hero-stats");
  [
    [summary.fixture.totalLineCount !== null ? `${summary.fixture.totalLineCount}` : "—", "fixture 行数"],
    [path.totalCalls, "真实工具调用"],
    [summary.chain.strongEdges.length, "强字段接力"],
    [summary.continuation?.stages.length || 0, "折叠的真实 step"],
  ].forEach(([value, label]) => {
    const item = h("div", "lesson-stat");
    add(item, h("strong", "", value), h("span", "", label));
    stats.append(item);
  });
  conclusion.append(stats);
  const replay = h("button", "text-button hero-trace-button", "从第一条真实事件开始回放 →");
  replay.type = "button";
  replay.addEventListener("click", () => jumpToRecord(state.runId, record.id, 0));
  conclusion.append(replay);

  const guide = h("aside", "lesson-hero-guide");
  guide.append(h("p", "eyebrow", "读完后应该能回答"));
  const list = h("ol", "lesson-question-list");
  [
    "实验到底在验证哪个 Agent 机制？",
    "哪一条 Observation 字段进入了下一次调用？",
    "连续分页为什么要折叠，折叠后证据有没有丢？",
    "每个 check 在防哪种“伪成功”？",
  ].forEach((text) => list.append(h("li", "", text)));
  guide.append(list);
  const boundary = h("div", "lesson-boundary");
  add(boundary,
    h("strong", "", "证据边界"),
    h("p", "", summary.boundary));
  guide.append(boundary);

  add(card, conclusion, guide);
  root.append(card);
}

function loopNode(id, label, detail, used, activeNode) {
  const classes = ["loop-node", `node-${id}`];
  if (used) classes.push("is-used");
  if (activeNode === id) classes.push("is-active");
  const node = h("div", classes.join(" "));
  add(node, h("span", "node-dot"), h("strong", "", label), h("small", "", detail));
  return node;
}

function renderLoopDiagram(root, record, activeEvent = null) {
  const grouped = Story.groupRounds(record);
  const journey = Story.loopJourney(record);
  const path = Story.toolPath(record);
  const activeNode = Story.loopNodeForEvent(activeEvent);
  const activeStep = activeEvent?.step ?? null;
  const requests = grouped.rounds.reduce((sum, round) => sum + round.requests.length, 0);
  const responses = grouped.rounds.reduce((sum, round) => sum + round.responses.length, 0);
  const results = grouped.rounds.reduce((sum, round) => sum + round.toolResults.length, 0);
  const toolRounds = journey.filter((item) => item.branch === "tool");
  const finishRounds = journey.filter((item) => item.branch === "finish");
  const compactionEvents = grouped.rounds.flatMap((round) => round.compactions);
  const approvalEvents = grouped.rounds.flatMap((round) => round.approvals);
  const errorEvents = grouped.rounds.flatMap((round) => round.errors);
  const toolNames = path.usedTools.join(" + ") || "本次未触发";

  const rootNode = clear(root);
  if (activeEvent) {
    const chip = h("div", "active-event-chip");
    add(chip,
      h("span", "active-event-dot"),
      h("strong", "", NODE_LABELS[activeNode] || activeNode),
      h("code", "", `event ${activeEvent.sequence ?? "—"} · ${activeEvent.event}${activeStep ? ` · S${activeStep}` : ""}`));
    rootNode.append(chip);
  }

  const machine = h("div", "loop-machine");
  const entry = h("div", "loop-entry");
  add(entry,
    loopNode("context", "上下文", `${requests} 次 model_request`, requests > 0, activeNode),
    h("span", "loop-arrow", "→"),
    loopNode("decision", "模型判断", `${responses} 次 model_response`, responses > 0, activeNode));
  machine.append(entry);

  const fork = h("div", "loop-fork");
  const toolBranch = h("div", `loop-branch tool-branch ${toolRounds.length ? "is-used" : "is-idle"} ${["tool", "observation"].includes(activeNode) ? "is-active" : ""}`);
  const toolLabel = h("div", "branch-condition");
  add(toolLabel, h("span", "condition-tag", "IF"), h("strong", "", "有 tool_call"));
  const toolRoute = h("div", "branch-route");
  add(toolRoute,
    loopNode("tool", "工具执行", `${toolNames} · ${path.totalCalls} 次`, toolRounds.length > 0, activeNode),
    h("span", "loop-arrow", "→"),
    loopNode("observation", "Observation", `${results} 条结果写回上下文`, results > 0, activeNode));
  const back = h("div", "loop-backline");
  add(back, h("span", "", "↺"), h("small", "", "写回后重新进入下一次模型判断"));
  const toolEvidence = h("p", "branch-evidence", toolRounds.length
    ? `本次 ${toolRounds.length} 轮走工具分支：${toolRounds.map((item) => `S${item.step}`).join("、")}`
    : "本次 Trace 没有进入工具分支");
  add(toolBranch, toolLabel, toolRoute, back, toolEvidence);

  const finishBranch = h("div", `loop-branch finish-branch ${finishRounds.length ? "is-used" : "is-idle"} ${activeNode === "finish" ? "is-active" : ""}`);
  const finishLabel = h("div", "branch-condition");
  add(finishLabel, h("span", "condition-tag else-tag", "ELSE"), h("strong", "", "没有 tool_call"));
  const finishRoute = h("div", "branch-route finish-route");
  finishRoute.append(loopNode("finish", "Agent 完成", finishRounds.length
    ? `本次在 ${finishRounds.map((item) => `S${item.step}`).join("、")} 结束`
    : "Trace 未记录完成分支", finishRounds.length > 0, activeNode));
  const finishEvidence = h("p", "branch-evidence", finishRounds.length
    ? "模型返回无 tool_calls 的响应，Loop 停止。"
    : "最末轮仍没有无工具调用的最终响应。");
  add(finishBranch, finishLabel, finishRoute, finishEvidence);
  add(fork, toolBranch, finishBranch);
  machine.append(fork);

  const conditionals = h("div", "loop-conditionals");
  const compactionNode = loopNode("compaction", "历史压缩", `${compactionEvents.length} 次检查 · ${compactionEvents.filter((event) => event.compacted).length} 次生效`, compactionEvents.length > 0, activeNode);
  const approvalNode = loopNode("approval", "审批闸门", approvalEvents.length ? `${approvalEvents.length} 次拦截` : "本次未触发", approvalEvents.length > 0, activeNode);
  conditionals.append(compactionNode, approvalNode);
  if (errorEvents.length) conditionals.append(loopNode("error", "异常分支", `${errorEvents.length} 次异常`, true, activeNode));
  machine.append(conditionals);
  rootNode.append(machine);

  const legend = h("div", "loop-legend");
  add(legend,
    h("span", "", "● 本次真实发生"),
    h("span", "", "○ 条件未触发"),
    h("span", "", "↺ observation 回环"),
    h("span", "", "只表达事件结构，不展示内部思维"));
  rootNode.append(legend);

  const caption = toolRounds.length
    ? `本次共 ${journey.length} 轮：${toolRounds.length} 轮进入工具分支，${finishRounds.length} 轮进入完成分支；${toolNames} 共调用 ${path.totalCalls} 次。路径由 step、tool_call、tool_result 事件重构。`
    : `本次共 ${journey.length} 轮，没有 tool_call，${finishRounds.length ? "最终进入完成分支" : "但没有记录完成分支"}。这里展示的是 Trace 结构，不是模型内部推理。`;
  return { caption, activeNode, journey };
}

function renderStoryParts(record) {
  const root = clear($("story-parts"));
  const counts = recordToolCounts(record);
  const usedTools = Object.keys(counts);
  if (!usedTools.length) {
    root.append(h("div", "no-data", "这条 Trace 没有调用工具。完整工具箱仍可从「乐高拆解」打开。"));
    return;
  }
  usedTools.forEach((name) => {
    const tool = state.data.catalog.tools.find((item) => item.name === name);
    if (!tool) {
      const unknown = h("div", "used-part unknown-part");
      add(unknown, h("span", "part-stud"), h("strong", "", name), h("small", "", "Trace 中出现，但 registry 未找到契约"));
      root.append(unknown);
      return;
    }
    const card = h("button", "used-part");
    card.type = "button";
    card.setAttribute("aria-label", `查看已使用工具 ${name}`);
    const top = h("div", "used-part-top");
    add(top, h("span", "part-stud"), h("code", "", name), h("span", `risk-badge risk-${tool.risk}`, RISK_LABELS[tool.risk] || tool.risk));
    add(card,
      top,
      h("p", "", tool.description),
      h("div", "part-slots", `${counts[name]} 次调用 · ${tool.architecture || "插槽位置未记录"}`),
      h("div", "part-source", `${tool.source.path}:${tool.source.line || "?"} · 打开契约 →`));
    card.addEventListener("click", () => openToolDialog(name));
    root.append(card);
  });
}

function fixtureVisual(fixture) {
  const visual = h("div", "fixture-visual");
  const first = fixture.fixtures?.[0] || null;
  if (!fixture.hasContract) {
    visual.append(h("span", "fixture-unknown", "未导入 fixture 摘要"));
    return visual;
  }
  if (!first) {
    visual.append(h("span", "fixture-unknown", "任务契约没有 fixture"));
    return visual;
  }
  if (first.kind === "repeated" && first.repeat && first.repeatLines) {
    const blocks = h("div", "fixture-repeat-blocks");
    const repeatCount = Math.min(first.repeat, 24);
    for (let index = 0; index < repeatCount; index += 1) {
      const block = h("span", "fixture-block");
      block.title = `重复块 ${index + 1} · ${first.repeatLines} 行`;
      blocks.append(block);
    }
    if (first.tailLines) blocks.append(h("span", "fixture-tail", `+${first.tailLines}`));
    add(visual, blocks, h("small", "", `${first.repeat} × ${first.repeatLines} 行重复块${first.tailLines ? ` + ${first.tailLines} 行尾部` : ""}`));
  } else {
    const bar = h("div", "fixture-plain-bar");
    bar.style.width = `${Math.max(12, Math.min(100, (first.lineCount || 1) / 4))}%`;
    add(visual, bar, h("small", "", first.composition));
  }
  return visual;
}

function appendBriefCheckList(parent, title, checks, emptyText) {
  const block = h("div", "brief-check-block");
  block.append(h("h4", "", title));
  const list = h("div", "brief-check-list");
  if (!checks?.length) {
    list.append(h("p", "brief-check-empty", emptyText));
  } else {
    checks.forEach((check) => {
      const item = h("div", "brief-check-item");
      add(item, checkBadge(check), h("span", "", check.label));
      list.append(item);
    });
  }
  block.append(list);
  parent.append(block);
}

function renderStoryBrief(summary, record) {
  const root = clear($("story-brief"));
  const grid = h("div", "story-brief-grid");

  const questionCard = h("article", "brief-card brief-question");
  questionCard.append(h("span", "brief-index", "01"));
  questionCard.append(h("p", "eyebrow", "实验问题"));
  questionCard.append(h("h2", "", "先把任务变成可观察的 Agent 实验"));
  if (summary.hasContract) {
    questionCard.append(h("blockquote", "task-prompt", summary.question));
    questionCard.append(h("p", "brief-note", "Prompt 来自任务契约，不从最终答案反推。页面把文字要求映射到 fixture、过程约束和结果验收。"));
  } else {
    const missing = h("div", "contract-missing");
    add(missing,
      h("strong", "", "未导入任务契约"),
      h("p", "", "不能补造 Prompt、fixture 规模或任务设计。当前页面只展示 Trace 与已有 checks。"));
    questionCard.append(missing);
  }
  const actual = h("div", "brief-actual");
  add(actual,
    h("span", "", `实际工具 · ${summary.toolNames.join(" + ") || "无 tool_call"}`),
    h("span", "", `真实轮次 · ${summary.chain.turns.length} 次带工具调用的 step`));
  questionCard.append(actual);

  const fixtureCard = h("article", "brief-card brief-fixture");
  fixtureCard.append(h("span", "brief-index", "02"));
  fixtureCard.append(h("p", "eyebrow", "Fixture 为什么这样设计"));
  const fixtureMetric = h("div", "fixture-metric");
  add(fixtureMetric,
    h("strong", "", summary.fixture.totalLineCount !== null ? summary.fixture.totalLineCount : "—"),
    h("span", "", "行"));
  fixtureCard.append(fixtureMetric);
  fixtureCard.append(h("p", "fixture-composition", summary.fixture.composition));
  fixtureCard.append(fixtureVisual(summary.fixture));
  fixtureCard.append(h("p", "brief-note", summary.hasContract
    ? "长度超过一次方便读取的范围，任务才真正逼出“读取 → Observation → 下一次 start_line”的分页路径。"
    : "没有任务契约时，不能声称 fixture 为什么被设计成这个长度。"));

  const checkCard = h("article", "brief-card brief-contract");
  checkCard.append(h("span", "brief-index", "03"));
  checkCard.append(h("p", "eyebrow", "成功标准与过程约束"));
  checkCard.append(h("h2", "", "答案正确，只是其中一条"));
  appendBriefCheckList(checkCard, "最终验收", summary.acceptance, "任务契约没有结果验收 check。");
  appendBriefCheckList(checkCard, "过程约束", summary.constraints, "任务契约没有过程约束 check。");
  const capability = summary.groups.find((group) => group.id === "capability")?.checks || [];
  appendBriefCheckList(checkCard, "能力证据", capability, "没有记录工具能力 check。");
  const integrity = summary.groups.find((group) => group.id === "integrity")?.checks || [];
  if (integrity.length) appendBriefCheckList(checkCard, "完整性 / 未验证项", integrity, "没有记录完整性 check。");

  add(grid, questionCard, fixtureCard, checkCard);
  root.append(grid);
}

function eventIndexForStage(record, stage) {
  const events = record?.events || [];
  const sequence = stage?.call?.sequence ?? stage?.response?.sequence ?? stage?.sequence;
  const index = events.findIndex((event) => sequence !== null && sequence !== undefined && Number(event.sequence) === Number(sequence));
  return index >= 0 ? index : 0;
}

function stageJumpButton(record, stage, label = "定位真实事件") {
  const button = h("button", "mini-button", `${label} →`);
  button.type = "button";
  button.addEventListener("click", () => jumpToRecord(state.runId, record.id, eventIndexForStage(record, stage)));
  return button;
}

function causalField(label, value, tone = "") {
  return h("span", `causal-field ${tone}`, `${label}=${value === null || value === undefined ? "未记录" : value}`);
}

function renderCausalStep(record, stage) {
  const row = h("article", "causal-step");
  const head = h("div", "causal-step-head");
  add(head,
    h("span", "causal-step-number", `S${stage.step}`),
    h("strong", "", `${stage.tool || "工具"} · ${stage.filePath || "路径未记录"}`),
    stageJumpButton(record, stage, "回放这一步"));
  row.append(head);
  const fields = h("div", "causal-fields");
  add(fields,
    causalField("start_line", stage.startLine),
    causalField("returned_range", stage.returnedRange),
    causalField("has_more", stage.hasMore),
    causalField("next_start_line", stage.nextStartLine, stage.hasMore === true ? "field-hot" : ""));
  row.append(fields);
  const narrative = h("div", "causal-step-copy");
  add(narrative,
    h("span", "", `调用：${Story.argumentSummary(stage.call)}`),
    h("span", "", `Observation：${stage.detail}`));
  row.append(narrative);
  return row;
}

function renderCausalEdge(edge) {
  const card = h("div", `causal-edge ${edge.strong ? "strong-edge" : "weak-edge"}`);
  const values = h("div", "causal-edge-values");
  if (edge.strong) {
    add(values,
      h("code", "", `Observation.next_start_line=${edge.observationValue}`),
      h("span", "causal-arrow", "→"),
      h("code", "", `下一次 tool_call.start_line=${edge.callValue}`));
  } else {
    add(values, h("strong", "", "未形成强字段边"), h("span", "", edge.reason || "可比较字段未匹配。"));
  }
  card.append(values);
  card.append(h("p", "", edge.strong ? "字段相等 · 内部动机未记录" : edge.reason));
  return card;
}

function continuationEpisode(record, episode, chain) {
  const details = h("details", "causal-episode continuation-episode");
  const summary = h("summary", "causal-episode-summary");
  const label = h("span", "episode-range", `S${episode.firstStep}–S${episode.lastStep}`);
  const copy = h("div", "episode-summary-copy");
  add(copy,
    h("h3", "", `一个分页目标，${episode.stages.length} 次连续接力`),
    h("p", "", episode.detail));
  const firstEdge = chain.links.find((edge) => edge.strong && edge.from === episode.stages[0]?.id);
  if (firstEdge) {
    const preview = h("div", "causal-preview");
    add(preview,
      h("code", "", `next_start_line=${firstEdge.observationValue}`),
      h("span", "", "→"),
      h("code", "", `start_line=${firstEdge.callValue}`),
      h("strong", "", "字段相等"));
    copy.append(preview);
  }
  summary.append(label, copy, h("span", "episode-expand", "展开真实步骤 +"));
  details.append(summary);

  const body = h("div", "causal-episode-body");
  body.append(h("p", "causal-body-note", "聚合只减少叙事噪音，不删除证据。每个 step 都能跳回 Replay，强边只在字段相等时高亮。"));
  const steps = h("div", "causal-steps");
  episode.stages.forEach((stage) => {
    steps.append(renderCausalStep(record, stage));
    const next = episode.stages.find((candidate) => candidate.step === stage.step + 1);
    if (!next) return;
    const edge = chain.links.find((link) => link.from === stage.id && link.to === next.id);
    if (edge) steps.append(renderCausalEdge(edge));
  });
  body.append(steps);
  details.append(body);
  return details;
}

function singleCausalEpisode(record, episode, chain) {
  const stage = episode.stages[0];
  if (!stage) return h("div", "no-data", "这个 episode 没有记录。");
  if (episode.kind === "stop") {
    const card = h("article", "causal-stop");
    const top = h("div", "causal-stop-head");
    add(top, h("span", "episode-range", stage.step ? `S${stage.step}` : "RUN"), h("h3", "", "停止 · model_response 不含 tool_calls"));
    card.append(top);
    card.append(h("p", "", stage.response
      ? `结构证据：最后一条 model_response 的 tool_calls 为空。最终文本：${compactText(stage.content || "空文本", 220)}`
      : "报告没有记录无 tool_calls 的最终响应，不能声称 Loop 正常停止。"));
    if (stage.response) card.append(stageJumpButton(record, stage, "定位停止事件"));
    return card;
  }
  if (episode.kind === "result") {
    const result = chain.result;
    const card = h("article", "causal-result");
    card.append(h("h3", "", "验收 · 每个结论都能回到 check"));
    const badges = h("div", "causal-result-badges");
    Object.entries(result.statusCounts || {}).forEach(([status, count]) => {
      const style = STATUS_STYLE[status];
      badges.append(h("span", `status-badge ${style.className}`, `${style.symbol} ${status} ${count}`));
    });
    card.append(badges);
    card.append(h("p", "", "结果验收与过程约束分开计分；SKIP 表示本次没有验证，不会自动变成 PASS。详细语义见下方 check 卡。"));
    return card;
  }
  const details = h("details", "causal-episode single-episode");
  const summary = h("summary", "causal-episode-summary");
  const copy = h("div", "episode-summary-copy");
  add(copy, h("h3", "", episode.title), h("p", "", episode.detail));
  summary.append(h("span", "episode-range", `S${stage.step}`), copy, h("span", "episode-expand", "展开证据 +"));
  details.append(summary);
  const body = h("div", "causal-episode-body");
  body.append(renderCausalStep(record, stage));
  details.append(body);
  return details;
}

function renderCausalChain(record, summary) {
  const root = clear($("story-causal-chain"));
  const rule = h("div", "causal-rule");
  add(rule,
    h("strong", "", "怎么读这条链"),
    h("p", "", "Observation 给出字段 → 下一次 tool_call 使用相同值 → 工具返回新的 Observation → 直到停止分支。"),
    h("span", "causal-rule-boundary", "内部动机未记录"));
  root.append(rule);

  const episodes = summary.episodes.filter((episode) => episode.kind !== "question");
  if (!episodes.length) {
    root.append(h("div", "no-data", "没有可重组的真实 episode。"));
    return;
  }
  episodes.forEach((episode) => {
    if (episode.kind === "continuation") root.append(continuationEpisode(record, episode, summary.chain));
    else root.append(singleCausalEpisode(record, episode, summary.chain));
  });
}

function renderStoryTakeaways(summary) {
  const root = clear($("story-takeaways"));
  const grid = h("div", "takeaway-grid");
  summary.takeaways.forEach((takeaway, index) => {
    const card = h("article", "takeaway-card");
    add(card,
      h("span", "takeaway-number", String(index + 1).padStart(2, "0")),
      h("h3", "", takeaway.title),
      h("p", "", takeaway.body));
    grid.append(card);
  });
  root.append(grid);
  root.append(h("p", "takeaways-boundary", "可观察 ≠ 因果归因：字段相等证明消息中出现同一值；它不证明模型“因为”这个值而行动。单次 A/B 只能定位路径差异，不能证明策略因果。"));
}

function renderStoryRounds(record) {
  const root = clear($("story-rounds"));
  const grouped = Story.groupRounds(record);
  $("story-round-title").textContent = `真实轮次明细 · ${grouped.rounds.length} 轮`;
  if (!grouped.rounds.length) {
    root.append(h("div", "no-data", "报告没有带 step 的模型轮次；请在 Loop 回放中查看 run-level 事件。"));
    return;
  }

  grouped.rounds.forEach((round) => {
    const card = h("details", `round-card round-${round.branch.type}`);
    const head = h("summary", "round-jump");
    const number = h("span", "round-number", `S${round.step}`);
    const title = h("span", "round-title");
    add(title, h("strong", "", round.narrative.headline), h("small", "", `${round.events.length} 条事件 · ${BRANCH_LABELS[round.branch.type] || round.branch.type}`));
    add(head, number, title, h("span", "round-jump-label", "展开明细 +"));
    card.append(head);

    const body = h("div", "round-body");
    const bodyActions = h("div", "round-body-actions");
    const headJump = h("button", "mini-button", "定位本轮 →");
    headJump.type = "button";
    headJump.addEventListener("click", () => jumpToRecord(state.runId, record.id, eventIndexForStep(record, round.step)));
    bodyActions.append(headJump);

    const request = round.requests[0] || null;
    const compaction = round.compactions[round.compactions.length - 1] || null;
    const facts = h("div", "round-facts");
    add(facts,
      h("span", "", request ? `上下文 ${formatNumber(request.context_chars)} 字符 / ${request.message_count ?? "?"} 条消息` : "上下文未记录"),
      h("span", "", compaction ? (compaction.compacted ? "压缩已生效" : `压缩未触发 · ${compaction.reason || "原因未记录"}`) : "本轮无压缩检查"),
      h("span", "", `分支 · ${BRANCH_LABELS[round.branch.type] || round.branch.type}`));
    add(body, bodyActions, facts, h("p", "round-narrative", round.narrative.detail));

    if (round.calls.length) {
      const calls = h("div", "round-calls");
      round.calls.forEach(({ call, result }) => {
        const row = h("div", "round-call");
        const copy = h("div", "round-call-copy");
        add(copy,
          h("code", "", call.tool || "unknown"),
          h("span", "", Story.argumentSummary(call)),
          h("small", "", result ? Story.observationSummary(result) : "没有关联到 tool_result 事件"));
        const actions = h("div", "round-call-actions");
        const jump = h("button", "mini-button", "定位调用");
        jump.type = "button";
        jump.addEventListener("click", () => jumpToRecord(state.runId, record.id, eventIndexForCall(record, call)));
        const contract = h("button", "mini-button ghost", "工具契约");
        contract.type = "button";
        contract.addEventListener("click", () => openToolDialog(call.tool));
        add(actions, jump, contract);
        add(row, copy, actions);
        calls.append(row);
      });
      body.append(calls);
    } else if (round.branch.type === "finish") {
      const response = round.responses[round.responses.length - 1];
      const finish = h("div", "round-finish");
      add(finish, h("span", "finish-mark", "STOP"), h("p", "", compactText(response?.content || "模型没有请求工具，但最终文本为空。", 220)));
      body.append(finish);
    } else if (round.errors.length) {
      body.append(h("div", "round-error", Story.observationSummary(round.errors[0])));
    }
    card.append(body);
    root.append(card);
  });
}

function renderCheckCard(check) {
  const classified = check?.status ? check : Story.classifyCheck(check);
  const status = ["PASS", "FAIL", "SKIP", "UNKNOWN"].includes(classified.status) ? classified.status : "UNKNOWN";
  const card = h("article", `check-card check-${status.toLowerCase()}`);
  const top = h("div", "check-card-top");
  add(top, checkBadge(classified), h("code", "check-raw-short", classified.check));
  card.append(top);
  card.append(h("h3", "", classified.label));
  const grid = h("div", "check-learning-grid");
  [
    ["检查什么", classified.purpose],
    ["防止哪种伪成功", classified.prevents],
    ["失败说明什么", classified.failure],
    ["对应 Agent 机制", classified.mechanism],
  ].forEach(([label, copy]) => {
    const block = h("div", "check-learning-item");
    add(block, h("span", "", label), h("p", "", copy));
    grid.append(block);
  });
  card.append(grid);
  if (classified.skipReason) card.append(h("p", "check-skip-reason", classified.skipReason));
  const raw = h("details", "check-raw");
  raw.append(h("summary", "", "查看原始 check 字段"), h("code", "", classified.check));
  card.append(raw);
  return card;
}

function renderChecks(element, checks) {
  const root = clear(element);
  if (!checks?.length) {
    root.append(h("div", "no-data", "没有 checks 记录。"));
    return;
  }
  const list = h("div", "check-card-list");
  checks.forEach((check) => list.append(renderCheckCard(check)));
  root.append(list);
}

function renderCheckGroups(element, groups) {
  const root = clear(element);
  if (!groups?.length) {
    root.append(h("div", "no-data", "没有 checks 记录。"));
    return;
  }
  groups.forEach((group) => {
    const section = h("section", "check-group");
    const head = h("div", "check-group-head");
    const heading = h("div");
    add(heading, h("h3", "", group.title), h("p", "", group.subtitle));
    const counts = h("div", "check-group-counts");
    ["PASS", "FAIL", "SKIP", "UNKNOWN"].forEach((status) => {
      const style = STATUS_STYLE[status];
      counts.append(h("span", `check-count ${style.className}`, `${style.symbol} ${status} ${group.summary[status]}`));
    });
    add(head, heading, counts);
    section.append(head, h("p", "check-group-description", group.description));
    const list = h("div", "check-card-list");
    if (group.checks.length) group.checks.forEach((check) => list.append(renderCheckCard(check)));
    else list.append(h("p", "brief-check-empty", "这一组没有 check；未记录不等于验证通过。"));
    section.append(list);
    root.append(section);
  });
}

function renderStory() {
  const run = currentRun();
  const record = currentRecord();
  fillTaskSelect($("story-task-select"), run, record?.id);
  if (!record) {
    clear($("story-hero")).append(h("div", "no-data", "这次运行没有任务记录。"));
    clear($("story-brief")).append(h("div", "no-data", "没有任务契约，无法解释实验问题。"));
    clear($("story-causal-chain")).append(h("div", "no-data", "没有 Trace，无法建立可观察因果链。"));
    clear($("story-loop")).append(h("div", "no-data", "没有 Trace，无法绘制 Loop。"));
    clear($("story-parts")).append(h("div", "no-data", "没有工具证据。"));
    clear($("story-rounds")).append(h("div", "no-data", "没有模型轮次。"));
    clear($("story-checks")).append(h("div", "no-data", "没有 checks。"));
    clear($("story-final")).append(h("div", "no-data", "没有最终响应。"));
    clear($("story-takeaways")).append(h("div", "no-data", "没有可支持的机制结论。"));
    return;
  }
  state.taskId = record.id;
  const grouped = Story.groupRounds(record);
  const path = Story.toolPath(record);
  const summary = Story.summarizeExperiment(record, state.data.task_contracts?.[record.id]);
  renderStoryHero(record, grouped, path, summary);
  renderStoryBrief(summary, record);
  renderCausalChain(record, summary);
  const loop = renderLoopDiagram($("story-loop"), record);
  $("story-loop-caption").textContent = loop.caption;
  renderStoryParts(record);
  renderStoryRounds(record);
  renderCheckGroups($("story-checks"), summary.groups);
  renderStoryTakeaways(summary);

  const finalRoot = clear($("story-final"));
  const finalText = grouped.finalResponse?.content || record.final_text || "";
  const bubble = h("div", "final-bubble");
  add(bubble,
    h("span", "final-source", grouped.finalResponse ? "来源：最后一条无 tool_calls 的 model_response" : "来源：报告的 final_text"),
    h("p", "", finalText || "报告没有记录最终文本响应。"));
  finalRoot.append(bubble);
  finalRoot.append(h("p", "evidence-note", "这是模型输出，不是模型内部推理；完整原始事件仍在 Loop 回放中可查。"));
}

function eventNarrative(event) {
  if (!event) return "没有事件。";
  const tool = event.tool ? ` · ${event.tool}` : "";
  switch (event.event) {
    case "run_started": return `最多 ${event.max_steps ?? "?"} 步 · 压缩策略 ${event.compaction_strategy || "off"}`;
    case "model_request": return Story.modelRequestSummary(event);
    case "model_response": {
      const calls = event.tool_calls || [];
      if (calls.length) {
        const names = calls.map((call) => call.name || "unknown").join(" + ");
        return `模型返回 ${calls.length} 个 tool call：${names}。`;
      }
      return `模型没有再请求工具，输出：${compactText(event.content || "空文本", 110)}`;
    }
    case "tool_call": return `调用 ${event.tool || "unknown"} · ${Story.argumentSummary(event)}`;
    case "tool_result": return `${event.ok === false ? "工具失败" : "工具成功"}${tool} · ${Story.observationSummary(event)}`;
    case "approval_denied": return Story.observationSummary(event);
    case "invalid_tool_arguments": return Story.observationSummary(event);
    case "history_compaction": return Story.observationSummary(event);
    case "run_finished": return `${event.status || "unknown"} · ${event.steps ?? "?"} steps`;
    case "model_error": return Story.observationSummary(event);
    case "compaction_model_request": return `摘要模型收到请求 · ${formatNumber(event.context_chars)} 字符`;
    case "compaction_model_response": return `摘要模型返回 ${compactText(event.content || "无文本", 90)}`;
    case "compaction_model_error": return `摘要模型异常 · ${compactText(event.error || "未记录", 100)}`;
    default: return EVENT_LABELS[event.event] || "结构化事件";
  }
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

function renderEventDetail(event) {
  const root = clear($("event-detail"));
  if (!event) {
    root.append(h("div", "no-data", "这个任务没有事件。"));
    return;
  }
  const header = h("div", "detail-header");
  add(header,
    h("p", "eyebrow", `EVENT ${event.sequence ?? "—"} · ${event.timestamp || "NO TIMESTAMP"}`),
    h("h2", "", event.event),
    h("p", "", eventNarrative(event)));
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
  if (event.content) payloads.push(["查看 observation / 输出原文", event.content]);
  if (event.arguments !== undefined) payloads.push(["调用参数", typeof event.arguments === "string" ? event.arguments : pretty(event.arguments)]);
  if (event.tool_calls?.length) payloads.push(["模型生成的 tool calls", pretty(event.tool_calls)]);
  if (event.error) payloads.push(["错误详情", event.error]);
  payloads.forEach(([label, value]) => {
    const details = h("details", "evidence-details");
    details.append(h("summary", "", label), h("pre", "", value));
    root.append(details);
  });
  const raw = h("details", "evidence-details raw-evidence");
  raw.append(h("summary", "", "原始事件 JSON"), h("pre", "", pretty(event)));
  root.append(raw);
}

function renderReplay() {
  const run = currentRun();
  const record = currentRecord();
  fillTaskSelect($("task-select"), run, record?.id);
  if (!record) {
    clear($("task-summary")).append(h("div", "no-data", "这次运行没有任务记录。"));
    clear($("event-timeline")).append(h("div", "no-data", "没有事件。"));
    clear($("event-detail")).append(h("div", "no-data", "没有事件详情。"));
    return;
  }
  state.taskId = record.id;
  const events = record.events || [];
  state.eventIndex = Math.max(0, Math.min(state.eventIndex, Math.max(0, events.length - 1)));
  const activeEvent = events[state.eventIndex] || null;

  const summary = clear($("task-summary"));
  const path = Story.toolPath(record);
  add(summary,
    h("strong", "", record.id),
    statusBadge(record.passed, record.status),
    h("span", "", `group: ${record.group || "未记录"}`),
    h("span", "", `${record.steps ?? "?"} steps`),
    h("span", "", formatDuration(record.duration_seconds)),
    h("span", "", `${record.tool_errors ?? 0} tool errors`),
    h("span", "", `${path.totalCalls} tool calls`));

  const loop = renderLoopDiagram($("loop-flow"), record, activeEvent);
  $("loop-caption").textContent = `${NODE_LABELS[loop.activeNode] || loop.activeNode}。${loop.caption}`;
  renderEventDetail(activeEvent);
  renderTurns(record);
  renderChecks($("replay-checks"), record.checks);
  $("event-count").textContent = `${events.length} events`;
  $("event-position").textContent = events.length
    ? `事件 ${state.eventIndex + 1} / ${events.length} · Step ${activeEvent.step ?? "—"} · ${activeEvent.event}`
    : "0 events";
  $("prev-event").disabled = state.eventIndex <= 0;
  $("next-event").disabled = state.eventIndex >= events.length - 1;
  $("play-events").disabled = events.length < 2;
  $("play-events").textContent = state.playing ? "Ⅱ 暂停" : "▶ 播放";

  const grouped = Story.groupRounds(record);
  const roundByStep = new Map(grouped.rounds.map((round) => [String(round.step), round]));
  const groups = [];
  const groupMap = new Map();
  events.forEach((event, index) => {
    const key = event.step === null || event.step === undefined ? "run" : `step-${event.step}`;
    if (!groupMap.has(key)) {
      const item = { key, label: key === "run" ? "Run-level 事件" : `Step ${event.step}`, events: [] };
      groupMap.set(key, item);
      groups.push(item);
    }
    groupMap.get(key).events.push({ event, index });
  });

  const timeline = clear($("event-timeline"));
  groups.forEach((group) => {
    const section = h("section", "timeline-round");
    const head = h("div", "timeline-round-head");
    const round = group.key.startsWith("step-") ? roundByStep.get(group.key.slice(5)) : null;
    add(head,
      h("strong", "", group.label),
      h("span", "", round ? `${BRANCH_LABELS[round.branch.type] || round.branch.type} · ${group.events.length} events` : `${group.events.length} events`));
    section.append(head);
    group.events.forEach(({ event, index }) => {
      const button = h("button", `event-item ${index === state.eventIndex ? "active" : ""}`);
      button.type = "button";
      const copy = h("span", "event-copy");
      add(copy, h("strong", "", `${event.event} · ${EVENT_LABELS[event.event] || "事件"}`), h("span", "", eventNarrative(event)));
      add(button,
        h("span", "event-sequence", String(event.sequence ?? index).padStart(2, "0")),
        copy,
        h("span", "event-step", event.step ? `S${event.step}` : "RUN"));
      button.addEventListener("click", () => {
        stopPlayback();
        state.eventIndex = index;
        renderReplay();
      });
      section.append(button);
    });
    timeline.append(section);
  });
  const active = timeline.querySelector(".event-item.active");
  if (active && !$("view-replay").hidden) timeline.scrollTop = Math.max(0, active.offsetTop - timeline.clientHeight / 2);
}

function stopPlayback() {
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
  state.playing = false;
  if (state.data && $("play-events")) $("play-events").textContent = "▶ 播放";
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

function toolEvidenceForRecord(record) {
  const evidence = new Set();
  if (!record) return evidence;
  const grouped = Story.groupRounds(record);
  if (grouped.rounds.length) evidence.add("loop");
  if (grouped.rounds.some((round) => round.requests.length)) evidence.add("context");
  if (grouped.rounds.some((round) => round.responses.length)) evidence.add("model");
  if (grouped.rounds.some((round) => round.calls.length)) evidence.add("tools");
  if (grouped.rounds.some((round) => round.approvals.length)) evidence.add("approval");
  if (grouped.rounds.some((round) => round.compactions.length || round.errors.length)) evidence.add("compaction");
  if ((record.events || []).length) evidence.add("trace");
  if ((record.checks || []).length) evidence.add("eval");
  return evidence;
}

function renderAnatomy() {
  const { catalog, runs } = state.data;
  const run = currentRun();
  const record = currentRecord();
  const summary = run?.summary || {};
  const usage = toolUsage(run);
  const usedToolCount = Object.values(usage).filter((item) => item.calls > 0).length;
  const stats = [
    [catalog.modules.length, "真实核心模块"],
    [catalog.tools.length, "registry 工具契约"],
    [usedToolCount, "当前运行实际使用"],
    [`${summary.passed ?? "—"}/${summary.total ?? "—"}`, "当前运行通过 · 单次快照"],
    [runs.length, "已导入实验运行"],
  ];
  const statRoot = clear($("anatomy-stats"));
  stats.forEach(([value, label]) => {
    const item = h("div", "assembly-stat");
    add(item, h("strong", "", value), h("span", "", label));
    statRoot.append(item);
  });

  const evidence = toolEvidenceForRecord(record);
  const moduleRoot = clear($("module-grid"));
  catalog.modules.forEach((module) => {
    const [abbr, color, soft] = MODULE_STYLE[module.id] || ["·", "#147d73", "#e0f1ec"];
    const used = evidence.has(module.id);
    const card = h("article", `module-card ${used ? "has-run-evidence" : "catalog-only"}`);
    card.style.setProperty("--module-color", color);
    card.style.setProperty("--module-soft", soft);
    const top = h("div", "module-top");
    add(top,
      h("span", "module-icon", abbr),
      h("span", "module-kind", module.kind),
      h("span", `evidence-chip ${used ? "detected" : ""}`, used ? "本次 Trace 命中" : "目录契约"));
    const slots = h("div", "module-slots");
    add(slots,
      h("span", "", `输入 · ${(module.inputs || []).join(" / ") || "未记录"}`),
      h("span", "", `输出 · ${(module.outputs || []).join(" / ") || "未记录"}`));
    const connections = h("div", "connection-list");
    (module.connects_to || []).forEach((target) => connections.append(h("span", "connection-chip", `→ ${target}`)));
    add(card, top, h("h3", "", module.name), h("p", "", module.summary), slots, connections, sourceLink(module.source));
    moduleRoot.append(card);
  });

  renderUsedTools();
  renderTools();
}

function renderUsedTools() {
  const root = clear($("used-tool-spotlight"));
  const record = currentRecord();
  const counts = recordToolCounts(record);
  const names = Object.keys(counts);
  if (!names.length) {
    root.append(h("div", "no-data used-tools-empty", "当前任务没有调用任何工具。完整工具箱仍保留所有真实契约。"));
    return;
  }
  names.forEach((name) => {
    const tool = state.data.catalog.tools.find((item) => item.name === name);
    const card = h("button", "used-tool-card");
    card.type = "button";
    card.setAttribute("aria-label", `查看已使用工具 ${name}`);
    const top = h("div", "used-tool-top");
    add(top,
      h("span", "lego-stud", "T"),
      h("code", "", name),
      h("span", "installed-label", `已插入 ×${counts[name]}`));
    add(card,
      top,
      h("p", "", tool?.description || "Trace 中出现，但 registry 未记录此工具契约。"),
      h("div", "tool-location", `位置 · ${tool?.architecture || "未记录"}`),
      h("div", "tool-card-footer", `${tool?.source?.path || "源码未知"}:${tool?.source?.line || "?"} · 打开契约 →`));
    card.addEventListener("click", () => openToolDialog(name));
    root.append(card);
  });
}

function renderTools() {
  if (!state.data || !$("tool-grid")) return;
  const query = $("tool-search").value.trim().toLowerCase();
  const risk = $("risk-filter").value;
  const usage = toolUsage(currentRun());
  const root = clear($("tool-grid"));
  const tools = state.data.catalog.tools.filter((tool) => {
    const matchesRisk = risk === "all" || tool.risk === risk;
    const haystack = `${tool.name} ${tool.description} ${tool.architecture || ""}`.toLowerCase();
    return matchesRisk && (!query || haystack.includes(query));
  });
  const summary = $("toolbox-summary-text");
  if (summary) summary.textContent = `${state.data.catalog.tools.length} 个真实工具 · 搜索、风险、Schema、源码和调用入口`;
  if (!tools.length) {
    root.append(h("div", "no-data", "没有符合筛选条件的工具。"));
    return;
  }
  tools.forEach((tool) => {
    const stats = usage[tool.name] || { calls: 0, errors: 0, denied: 0 };
    const card = h("button", `tool-card ${stats.calls ? "tool-used" : ""}`);
    card.type = "button";
    card.setAttribute("aria-label", `查看工具 ${tool.name}`);
    const top = h("div", "tool-card-top");
    add(top,
      h("h3", "", tool.name),
      h("span", `risk-badge risk-${tool.risk}`, RISK_LABELS[tool.risk] || tool.risk));
    if (stats.calls) top.append(h("span", "tool-used-label", "本次使用"));
    const meta = h("div", "tool-meta");
    add(meta,
      h("span", "", `调用 ${stats.calls}`),
      h("span", "", `错误 ${stats.errors}`),
      h("span", "", `拒绝 ${stats.denied}`));
    const footer = h("div", "tool-card-footer");
    add(footer, h("code", "", `${tool.source.path}:${tool.source.line || "?"}`), h("span", "", "拆解 →"));
    add(card, top, h("p", "", tool.description), h("div", "tool-location", tool.architecture), meta, footer);
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
  const usage = toolUsage(currentRun())[toolName] || { calls: 0, entries: [] };
  const dialog = $("tool-dialog");
  const root = clear($("tool-dialog-content"));
  const inner = h("div", "dialog-inner");
  const close = h("button", "dialog-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "关闭工具详情");
  close.addEventListener("click", () => dialog.close());
  add(inner, close, h("p", "eyebrow", "TOOL CONTRACT · READ ONLY"), h("h2", "dialog-title", tool.name));
  const badges = h("div", "dialog-badges");
  add(badges,
    h("span", `risk-badge risk-${tool.risk}`, RISK_LABELS[tool.risk] || tool.risk),
    h("span", `evidence-chip ${usage.calls ? "detected" : ""}`, usage.calls ? `当前运行已调用 ${usage.calls} 次` : "当前运行未调用"));
  inner.append(badges);
  add(inner, h("p", "dialog-description", tool.description));

  const contract = h("section", "dialog-section");
  add(contract, h("h3", "", "在 Agent 中的插槽位置"), h("div", "contract-box", tool.architecture));
  const sources = h("div", "dialog-sources");
  add(sources, sourceLink(tool.source), sourceLink(tool.registry_source));
  contract.append(sources);
  inner.append(contract);

  const schema = h("details", "dialog-section dialog-details");
  schema.append(h("summary", "", "查看 JSON Schema"), h("pre", "", pretty(tool.parameters)));
  inner.append(schema);
  const example = h("section", "dialog-section");
  add(example,
    h("h3", "", usage.entries.length ? "第一次真实调用参数" : "按 Schema 生成的参数结构（非真实调用）"),
    h("pre", "", pretty(exampleArguments(tool, usage.entries[0]))));
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
      add(button,
        h("code", "", `${entry.record.id} · step ${entry.event.step ?? "—"}`),
        h("span", "", `${resultText} →`));
      button.addEventListener("click", () => {
        const index = eventIndexForCall(entry.record, entry.event);
        dialog.close();
        jumpToRecord(state.runId, entry.record.id, index);
      });
      list.append(button);
    });
    calls.append(list);
  }
  inner.append(calls);
  root.append(inner);
  dialog.showModal();
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
    {
      label: "任务通过",
      value: (run) => run.summary.passed,
      display: (run) => `${run.summary.passed ?? "—"}/${run.summary.total ?? "—"} · ${formatPercent(run.summary.success_rate)}`,
      delta: (a, b) => {
        const value = ((b.summary.success_rate || 0) - (a.summary.success_rate || 0)) * 100;
        return `${value >= 0 ? "+" : ""}${value.toFixed(2)} 个百分点`;
      },
    },
    { label: "总模型 Token", key: "total_model_tokens", fallback: "total_tokens", digits: 0 },
    {
      label: "总耗时",
      key: "duration_seconds",
      digits: 2,
      displayValue: formatDuration,
      delta: (a, b) => `B − A = ${formatDuration(Number(b.summary.duration_seconds || 0) - Number(a.summary.duration_seconds || 0))}`,
    },
    { label: "平均模型步数", key: "average_steps", digits: 2 },
    { label: "平均峰值 prompt Token", key: "average_peak_prompt_tokens", digits: 2 },
    {
      label: "压缩 / 回退",
      value: (run) => run.summary.total_compactions,
      display: (run) => `${formatNumber(run.summary.total_compactions)} / ${formatNumber(run.summary.total_compaction_fallbacks)}`,
      delta: (a, b) => `压缩 B−A：${formatNumber((b.summary.total_compactions || 0) - (a.summary.total_compactions || 0))}；回退 B−A：${formatNumber((b.summary.total_compaction_fallbacks || 0) - (a.summary.total_compaction_fallbacks || 0))}`,
    },
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
  const thead = h("thead");
  thead.append(header);
  table.append(thead);
  const body = h("tbody");
  Object.keys(aConfig).forEach((key) => {
    const different = pretty(aConfig[key]) !== pretty(bConfig[key]);
    const row = h("tr", different ? "diff-row" : "");
    add(row, h("td", "", key), h("td", "", aConfig[key] ?? "未记录"), h("td", "", bConfig[key] ?? "未记录"));
    body.append(row);
  });
  table.append(body);
  root.append(table);
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
      ["主模型输入", mainInput, "token-main-input"],
      ["主模型输出", mainOutput, "token-main-output"],
      ["摘要输入", summaryInput, "token-summary-input"],
      ["摘要输出", summaryOutput, "token-summary-output"],
    ].forEach(([label, value, className]) => {
      const item = h("span", "", `${label} ${formatNumber(value)}`);
      const dot = h("i", className);
      item.prepend(dot);
      legend.append(item);
    });
    add(container, header, stack, legend);
    root.append(container);
  });
}

function divergenceRecordCard(run, record, side) {
  const card = h("div", "divergence-side");
  card.append(h("p", "eyebrow", `RUN ${side} · ${run.label}`));
  if (!record) {
    card.append(h("div", "no-data", "该运行没有这个任务。"));
    return card;
  }
  const top = h("div", "divergence-outcome");
  add(top, statusBadge(record.passed, record.status), h("code", "", record.id));
  const path = Story.toolPath(record);
  add(card,
    top,
    h("div", "divergence-facts", `${record.steps ?? "?"} steps · ${path.totalCalls} tool calls · ${path.usedTools.join(" + ") || "无工具"}`),
    h("p", "muted", compactText(record.final_text || "没有 final_text", 120)));
  const button = h("button", "mini-button divergence-trace", `查看 ${side} 的真实 Trace →`);
  button.type = "button";
  button.addEventListener("click", () => jumpToRecord(run.id, record.id, 0));
  card.append(button);
  return card;
}

function renderFirstDivergence(a, b) {
  const root = clear($("first-divergence"));
  const diff = Story.findFirstDivergence(a, b);
  const card = h("article", `divergence-card divergence-${diff.type}`);
  const header = h("div", "divergence-header");
  add(header, h("p", "eyebrow", "FIRST OBSERVABLE DIVERGENCE"), h("h2", "", diff.type === "result" ? "首个任务结果分叉" : (diff.type === "check" ? "首个 check 分叉" : "未发现可观察差异")));
  card.append(header);

  if (diff.type === "none") {
    add(card,
      h("p", "", "两份运行的任务 PASS/FAIL 与可对齐 checks 没有差异。"),
      h("p", "evidence-note", "这不代表策略等价；仍需结合任务覆盖、Token、耗时和更多重复实验判断。"));
    root.append(card);
    return;
  }

  const taskLine = h("div", "divergence-taskline");
  add(taskLine, h("strong", "", diff.taskId || "未记录任务"), h("span", "", "这是按报告任务顺序找到的第一处差异，不是因果归因。"));
  card.append(taskLine);

  const sides = h("div", "divergence-grid");
  sides.append(divergenceRecordCard(a, diff.a, "A"), divergenceRecordCard(b, diff.b, "B"));
  card.append(sides);

  if (diff.check) {
    const check = h("div", "divergence-check");
    check.append(h("p", "eyebrow", `FIRST DIFFERENT CHECK · #${diff.check.index + 1}`));
    const grid = h("div", "check-diff-grid");
    [[diff.check.a, "A"], [diff.check.b, "B"]].forEach(([item, side]) => {
      const block = h("div", "check-diff");
      const badge = item
        ? checkBadge(Story.classifyCheck(item), `${side} · `)
        : h("span", "status-badge status-unknown", `${side} · ? 缺失`);
      add(block, badge, h("code", "", item?.check || `该侧没有对应 check · ${side}`));
      grid.append(block);
    });
    check.append(grid);
    card.append(check);
  } else {
    card.append(h("p", "divergence-no-check", "任务结果不同，但报告没有可对齐的 checks 明细；请进入两侧 Trace 复核路径。"));
  }
  card.append(h("p", "evidence-note", "分叉来自固定任务报告与 checks；这只是单次 Live Eval 快照，不能单独证明压缩策略导致结果变化。"));
  root.append(card);
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
    row.dataset.taskId = id;
    const main = h("div", "task-row-main");
    const taskButton = h("button", "task-link", id);
    taskButton.type = "button";
    taskButton.addEventListener("click", () => jumpToRecord(a.id, id, 0));
    main.append(taskButton);
    [[a, aRecord, "A"], [b, bRecord, "B"]].forEach(([run, record, side]) => {
      if (!record) {
        main.append(h("span", "muted", `${side} · 无任务`));
        return;
      }
      const status = normalizedStatus(record.passed, record.status);
      const style = STATUS_STYLE[status];
      const button = h("button", `status-badge ${style.className}`);
      button.type = "button";
      button.style.border = "0";
      button.textContent = `${side} · ${style.symbol} ${status}`;
      button.title = `回放 ${run.label} / ${id} · ${status}`;
      button.addEventListener("click", () => jumpToRecord(run.id, id, 0));
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
      column.append(list);
      grids.append(column);
    });
    details.append(grids);
    row.append(details);
    root.append(row);
  });
}

function renderComparisonUnavailable(a) {
  const root = clear($("first-divergence"));
  const card = h("article", "divergence-card divergence-single");
  add(card,
    h("p", "eyebrow", "A/B REQUIRES TWO RUNS"),
    h("h2", "", "当前只有一份实验报告"),
    h("p", "", "A/B 对比至少需要两份包含任务记录的运行。现在的数据只能做单运行复盘，不能计算分叉。"),
    h("div", "divergence-facts", `当前运行 · ${a.label} · ${a.records.length} tasks · ${a.model || "unknown model"}`),
    h("p", "evidence-note", "请再用不同参数运行一次 Eval，并一起传给 scripts/export_dashboard.py。"));
  root.append(card);
  ["metric-comparison", "config-comparison", "token-comparison", "task-comparison"].forEach((id) => {
    clear($(id)).append(h("div", "no-data", "需要至少两份实验报告才能进行 A/B 对比。"));
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
    context.append(h("span", `compare-context-chip ${side === "A" ? "run-a" : "run-b"}`, `${side}: ${run.provider || "?"} / ${run.model || "?"} · N=${run.summary.total ?? run.records.length} · commit ${run.code_revision || "未记录"}`));
  });
  context.append(h("span", "compare-context-chip", `导出于 ${state.data.generated_at}`));

  const single = state.data.runs.length < 2;
  $("compare-b").disabled = single;
  $("swap-runs").disabled = single;
  if (single) {
    renderComparisonUnavailable(a);
    return;
  }

  renderFirstDivergence(a, b);
  renderMetricComparison(a, b);
  renderConfigComparison(a, b);
  renderTokenComparison(a, b);
  renderTaskComparison(a, b);
}

function disableControls(disabled) {
  document.querySelectorAll(".view-tab, #global-run-select, #task-select, #story-task-select, #compare-a, #compare-b, #swap-runs").forEach((element) => {
    element.disabled = disabled;
  });
}

function showEmpty() {
  $("empty-state").hidden = false;
  $("error-state").hidden = true;
  $("dashboard-content").hidden = true;
  disableControls(true);
}

function showError(message) {
  $("empty-state").hidden = true;
  $("error-state").hidden = false;
  $("error-message").textContent = message;
  $("dashboard-content").hidden = true;
  disableControls(true);
}

async function loadData() {
  try {
    if (!Story) throw new Error("story.js 未加载，无法把 Trace 重构为任务故事");
    const response = await fetch("data.json", { cache: "no-store" });
    if (response.status === 404) {
      showEmpty();
      return;
    }
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
    disableControls(false);
    document.querySelector(".local-badge").title = `生成于 ${data.generated_at} · ${data.data_classification}`;
    renderAll();
    switchView("story");
  } catch (error) {
    showError(`${error.message}。请检查 data.json，或重新运行导出命令。`);
  }
}

function bindEvents() {
  document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const tabs = [...document.querySelectorAll(".view-tab")];
      const index = tabs.indexOf(tab);
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[next].focus();
      switchView(tabs[next].dataset.view);
    });
  });
  $("global-run-select").addEventListener("change", (event) => {
    stopPlayback();
    state.runId = event.target.value;
    state.taskId = currentRun()?.records[0]?.id || null;
    state.eventIndex = 0;
    renderAll();
  });
  $("story-task-select").addEventListener("change", (event) => {
    stopPlayback();
    state.taskId = event.target.value;
    state.eventIndex = 0;
    syncTaskSelects();
    renderStory();
  });
  $("task-select").addEventListener("change", (event) => {
    stopPlayback();
    state.taskId = event.target.value;
    state.eventIndex = 0;
    syncTaskSelects();
    renderReplay();
  });
  $("view-all-parts").addEventListener("click", () => {
    switchView("anatomy");
    const details = document.querySelector(".toolbox-details");
    if (details) details.open = false;
  });
  $("tool-search").addEventListener("input", renderTools);
  $("risk-filter").addEventListener("change", renderTools);
  $("prev-event").addEventListener("click", () => {
    stopPlayback();
    state.eventIndex = Math.max(0, state.eventIndex - 1);
    renderReplay();
  });
  $("next-event").addEventListener("click", () => {
    stopPlayback();
    state.eventIndex += 1;
    renderReplay();
  });
  $("play-events").addEventListener("click", togglePlayback);
  $("compare-a").addEventListener("change", (event) => {
    state.compareA = event.target.value;
    ensureCompareRuns();
    renderCompare();
  });
  $("compare-b").addEventListener("change", (event) => {
    state.compareB = event.target.value;
    ensureCompareRuns();
    renderCompare();
  });
  $("swap-runs").addEventListener("click", () => {
    [state.compareA, state.compareB] = [state.compareB, state.compareA];
    renderCompare();
  });
  $("tool-dialog").addEventListener("click", (event) => {
    if (event.target === $("tool-dialog")) $("tool-dialog").close();
  });
  document.addEventListener("keydown", (event) => {
    if (state.view !== "replay" || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName) || $("tool-dialog").open) return;
    if (event.key === "ArrowLeft" && state.eventIndex > 0) {
      event.preventDefault();
      stopPlayback();
      state.eventIndex -= 1;
      renderReplay();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      stopPlayback();
      state.eventIndex = Math.min((currentRecord()?.events.length || 1) - 1, state.eventIndex + 1);
      renderReplay();
    }
  });
}

bindEvents();
loadData();
