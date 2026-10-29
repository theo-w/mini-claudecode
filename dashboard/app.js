"use strict";

const Story = globalThis.AgentStory;
const Evolution = globalThis.AgentEvolution;
const Lego = globalThis.AgentLego;

const state = {
  data: null,
  dataState: "loading",
  view: "build",
  buildStep: 0,
  buildAnswers: {},
  learnStep: 1,
  legoSelection: new Set(Lego?.DEFAULT_SELECTION || []),
  legoResult: null,
  legoPending: null,
  legoRuns: [],
  legoNextRunNumber: 1,
  legoRunning: false,
  legoVisibleEvents: 0,
  legoTimer: null,
  runId: null,
  taskId: null,
  eventIndex: 0,
  compareA: null,
  compareB: null,
  playing: false,
  timer: null,
};

const LEARN_STEPS = [
  { number: 1, title: "看结论", question: "这次运行发生了什么？" },
  { number: 2, title: "认零件", question: "哪些组件参与，分别在何时、何处？" },
  { number: 3, title: "看循环", question: "Observation 怎样进入下一步？" },
  { number: 4, title: "懂测试", question: "这些测试为什么这样判？" },
  { number: 5, title: "做复盘", question: "这次运行能带走什么结论？" },
];

const BUILD_PARTS = [
  { id: "model-only", icon: "M", label: "Model" },
  { id: "first-tool", icon: "T", label: "Tool" },
  { id: "tool-loop", icon: "L", label: "Loop" },
  { id: "tool-registry", icon: "R", label: "Registry" },
  { id: "safety-boundary", icon: "G", label: "Guardrail" },
  { id: "trace", icon: "E", label: "Trace" },
  { id: "eval", icon: "V", label: "Eval" },
];

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

function h(tag, className, ...content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  content.flat().forEach((part) => {
    if (part === undefined || part === null || part === false) return;
    if (part instanceof Node) {
      element.append(part);
    } else {
      element.append(document.createTextNode(String(part)));
    }
  });
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
  fillTaskSelect($("learn-task-select"), run, record?.id);
  fillTaskSelect($("story-task-select"), run, record?.id);
  fillTaskSelect($("task-select"), run, record?.id);
}

function preferredRecord(run) {
  return run?.records.find((record) => normalizedStatus(record.passed, record.status) === "FAIL")
    || run?.records[0]
    || null;
}

function syncViewVisibility() {
  const standaloneView = ["build", "lego"].includes(state.view);
  document.querySelectorAll(".view-tab").forEach((tab) => {
    const active = tab.dataset.view === state.view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.hidden = panel.id !== `view-${state.view}`;
  });
  $("dashboard-content").hidden = standaloneView || !state.data;
  $("empty-state").hidden = standaloneView || state.dataState !== "missing";
  $("error-state").hidden = standaloneView || state.dataState !== "error";
}

function switchView(view) {
  if (state.view !== view) stopPlayback();
  state.view = view;
  syncViewVisibility();
  renderView(view);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderView(view) {
  if (view === "build") {
    renderBuild();
    return;
  }
  if (view === "lego") {
    renderLego();
    return;
  }
  if (!state.data || !Story) return;
  if (view === "learn") renderLearn();
  if (view === "story") renderStory();
  if (view === "replay") renderReplay();
  if (view === "anatomy") renderAnatomy();
  if (view === "compare") renderCompare();
}

function renderAll() {
  fillRunSelect($("global-run-select"), state.runId);
  syncTaskSelects();
  renderLearn();
  renderStory();
  renderReplay();
  renderAnatomy();
  renderCompare();
  if (state.view === "lego") renderLego();
}

function buildCorrectIndex(chapter) {
  return chapter?.quiz?.options?.findIndex((option) => option.correct === true) ?? -1;
}

function buildChapterIsCorrect(chapter) {
  return state.buildAnswers[chapter.id] === buildCorrectIndex(chapter);
}

function buildCorrectCount() {
  if (!Evolution) return 0;
  return Evolution.CHAPTERS.filter(buildChapterIsCorrect).length;
}

function renderBuildDataStatus() {
  const root = $("build-data-status");
  if (!root) return;
  const status = state.dataState;
  const content = status === "ready"
    ? {
      title: "真实 Trace 已接通",
      detail: `${state.data?.runs?.length || 0} 次运行可供继续解剖`,
    }
    : status === "error"
      ? {
        title: "真实数据暂不可用",
        detail: "课程内容不依赖数据，可以先完成基础课",
      }
      : status === "missing"
        ? {
          title: "基础课可以独立完成",
          detail: "真实解剖入口需要 dashboard/data.json",
        }
        : {
          title: "课程可独立阅读",
          detail: "正在检查真实 Trace…",
        };
  root.replaceChildren();
  root.className = `build-data-status is-${status}`;
  add(root,
    h("span", "build-status-dot", ""),
    h("div", "", h("strong", "", content.title), h("small", "", content.detail)));
}

function renderBuildChapterList() {
  const root = $("build-chapter-list");
  if (!root || !Evolution) return;
  clear(root);
  Evolution.CHAPTERS.forEach((chapter, index) => {
    const active = index === state.buildStep;
    const correct = buildChapterIsCorrect(chapter);
    const button = h("button", `build-chapter-button${active ? " active" : ""}${correct ? " is-correct" : ""}`);
    button.type = "button";
    button.dataset.buildChapter = String(index);
    button.setAttribute("aria-label", `第 ${chapter.number} 章：${chapter.title}`);
    if (active) button.setAttribute("aria-current", "step");
    add(button,
      h("span", "build-chapter-number", String(chapter.number).padStart(2, "0")),
      h("span", "build-chapter-copy", h("strong", "", chapter.routeLabel), h("small", "", chapter.title)),
      h("span", "build-chapter-state", correct ? "✓" : active ? "在读" : ""));
    root.append(button);
  });

  const correctCount = buildCorrectCount();
  const total = Evolution.CHAPTERS.length;
  const count = $("build-progress-count");
  const fill = $("build-progress-fill");
  const copy = $("build-progress-copy");
  if (count) count.textContent = `${correctCount} / ${total}`;
  if (fill) fill.style.width = `${(correctCount / total) * 100}%`;
  if (copy) {
    copy.textContent = correctCount === total
      ? "七章检查全部通过。现在用真实 Trace 验证这条认知路径。"
      : "每章答对检查题后点亮一个零件；可以随时回看上一章。";
  }
}

function renderBuildStack(index) {
  const root = $("build-stack");
  if (!root) return;
  clear(root);
  BUILD_PARTS.forEach((part, partIndex) => {
    const installed = partIndex <= index;
    const current = partIndex === index;
    const item = h("div", `build-part${installed ? " installed" : " pending"}${current ? " current" : ""}`);
    if (current) item.setAttribute("aria-current", "step");
    add(item,
      h("span", "build-part-icon", part.icon),
      h("span", "build-part-copy", h("strong", "", part.label), h("small", "", installed ? (current ? "本章装配" : "已装入") : "待加入")),
      h("span", "build-part-joint", partIndex === BUILD_PARTS.length - 1 ? "" : "＋"));
    root.append(item);
  });
}

function buildLessonSection(marker, label, tone, title, body) {
  const section = h("section", `build-lesson-section build-${tone}`);
  const heading = h("div", "build-lesson-heading");
  add(heading,
    h("span", "build-lesson-marker", marker),
    h("div", "", h("span", "build-lesson-label", label), h("h2", "", title)));
  section.append(heading);
  if (body) section.append(h("p", "build-lesson-body", body));
  return section;
}

function renderBuildQuiz(chapter, mount) {
  if (!mount) return;
  clear(mount);
  const selected = state.buildAnswers[chapter.id];
  const selectedOption = Number.isInteger(selected) ? chapter.quiz.options[selected] : null;
  const solved = buildChapterIsCorrect(chapter);
  const options = h("div", "build-quiz-options");

  chapter.quiz.options.forEach((option, index) => {
    const isSelected = selected === index;
    const stateClass = isSelected ? (option.correct ? " is-correct" : " is-wrong") : "";
    const button = h("button", `build-quiz-option${stateClass}`);
    button.type = "button";
    button.setAttribute("aria-pressed", String(isSelected));
    button.disabled = solved;
    add(button,
      h("span", "build-quiz-letter", String.fromCharCode(65 + index)),
      h("span", "build-quiz-copy", option.text),
      h("span", "build-quiz-mark", isSelected ? (option.correct ? "✓" : "×") : ""));
    button.addEventListener("click", () => {
      state.buildAnswers[chapter.id] = index;
      renderBuildChapterList();
      renderBuildQuiz(chapter, mount);
      const feedback = mount.querySelector(".build-quiz-feedback");
      feedback?.focus({ preventScroll: true });
    });
    options.append(button);
  });
  mount.append(options);

  if (selectedOption) {
    const feedback = h("div", `build-quiz-feedback ${selectedOption.correct ? "correct" : "wrong"}`);
    feedback.tabIndex = -1;
    add(feedback,
      h("strong", "", selectedOption.correct ? "这一章已经理解" : "还差一步"),
      h("p", "", selectedOption.feedback),
      h("small", "", selectedOption.correct ? "可以继续下一章，或回到上面的代码再核对一次。" : "再选一次。错误反馈也保留了，帮助看清两个概念的差别。"));
    mount.append(feedback);
  } else {
    mount.append(h("p", "build-quiz-hint", "先选一个答案。选错不会跳章，会解释为什么不够准确。"));
  }
}

function renderBuildFuture(chapter) {
  if (!Evolution || chapter.id !== "eval") return null;
  const section = h("section", "build-future");
  const head = h("div", "build-future-head");
  add(head,
    h("p", "eyebrow", "AFTER THE BASELINE · WHAT COMES NEXT"),
    h("h2", "", "先有 Tool、Trace 和 Eval，才轮到 Skill"),
    h("p", "", "Skill 不是“更高级的 Tool”。它把一类任务的流程知识封装起来，但执行能力、权限和证据边界仍然来自 Tool 与 Harness。"));
  section.append(head);

  const compare = h("div", "build-tool-skill-grid");
  [Evolution.TOOL_VS_SKILL.tool, Evolution.TOOL_VS_SKILL.skill].forEach((item, index) => {
    const card = h("article", `build-concept-card ${index === 0 ? "tool" : "skill"}`);
    add(card,
      h("span", "build-concept-index", index === 0 ? "T" : "S"),
      h("p", "eyebrow", index === 0 ? "EXECUTABLE CAPABILITY" : "REUSABLE PROCESS"),
      h("h3", "", item.label),
      h("p", "", item.definition),
      h("code", "", item.example));
    compare.append(card);
  });
  section.append(compare);
  section.append(h("p", "build-concept-relation", Evolution.TOOL_VS_SKILL.relation));

  const roadmapHead = h("div", "build-roadmap-head");
  add(roadmapHead,
    h("h3", "", "后面的能力，不是下一步的必选项"),
    h("p", "", "每一项都要说明“为什么现在需要”和“新增了什么失败模式”。"));
  section.append(roadmapHead);
  const roadmap = h("div", "build-roadmap-grid");
  Evolution.ROADMAP.forEach((item, index) => {
    const card = h("article", "build-roadmap-card");
    add(card,
      h("span", "build-roadmap-number", String(index + 1).padStart(2, "0")),
      h("div", "build-roadmap-title", h("h4", "", item.title), h("span", "", "LATER")),
      h("p", "", item.trigger),
      h("small", "", `新增成本：${item.cost}`));
    roadmap.append(card);
  });
  section.append(roadmap);

  const outcomes = h("aside", "build-outcomes");
  const outcomesHead = h("div", "build-outcomes-head");
  add(outcomesHead,
    h("p", "eyebrow", "TAKE AWAY"),
    h("h3", "", "这条学习路径只留下 5 句话"),
    h("span", "", "每句话都必须能回到前面某一章的失败与补丁"));
  outcomes.append(outcomesHead);
  const list = h("ol", "build-outcome-list");
  Evolution.OUTCOMES.forEach((item) => list.append(h("li", "", item)));
  outcomes.append(list);
  section.append(outcomes);

  const cta = h("div", "build-final-cta");
  add(cta,
    h("div", "", h("p", "eyebrow", "NEXT · REAL TRACE"), h("h3", "", "现在把同一套问题带到真实运行里"), h("p", "", "真实解剖不要求你先相信课程。它会打开一次实际 Trace，让你逐个检查工具、Observation、Loop、checks 和最终交付。")),
    h("span", "build-final-note", state.dataState === "ready" ? "真实数据已就绪" : "需要导出 data.json"));
  const legoButton = h("button", "build-enter-lego", "先玩自由装配 →");
  legoButton.type = "button";
  legoButton.addEventListener("click", () => switchView("lego"));
  const traceButton = h("button", "build-enter-trace", "进入真实解剖 →");
  traceButton.type = "button";
  traceButton.addEventListener("click", () => switchView("learn"));
  const actions = h("div", "build-final-actions");
  actions.append(legoButton, traceButton);
  cta.append(actions);
  section.append(cta);
  return section;
}

function renderBuild() {
  const content = $("build-content");
  if (!content) return;
  if (!Evolution) {
    clear(content).append(h("div", "no-data", "evolution.js 未加载，无法显示基础课程。"));
    return;
  }

  const index = Math.max(0, Math.min(Evolution.CHAPTERS.length - 1, Number(state.buildStep) || 0));
  state.buildStep = index;
  const chapter = Evolution.chapterAt(index);
  renderBuildDataStatus();
  renderBuildChapterList();
  renderBuildStack(index);

  const root = clear(content);
  const head = h("header", "build-chapter-head");
  const version = h("div", "build-version-card");
  add(version,
    h("span", "", `BUILD ${String(chapter.number).padStart(2, "0")}`),
    h("strong", "", chapter.number === 1 ? "只有模型" : `＋ ${chapter.routeLabel}`),
    h("small", "", chapter.number === 1 ? "baseline v0" : `after chapter ${chapter.number - 1}`));
  const intro = h("div", "build-chapter-intro");
  const chapterTitle = h("h1", "", chapter.title);
  chapterTitle.id = "build-chapter-title";
  chapterTitle.tabIndex = -1;
  add(intro,
    h("p", "eyebrow", chapter.kicker),
    chapterTitle,
    h("p", "", chapter.promise));
  head.append(intro, version);
  root.append(head);

  const progress = h("div", "build-chapter-meta");
  add(progress,
    h("span", "", Evolution.progressLabel(index)),
    h("span", "", "阅读 → 观察 → 解释 → 检查"),
    h("span", "", Evolution.COURSE_META.disclaimer));
  root.append(progress);

  const pain = buildLessonSection("01", "旧版本撞墙", "pain", chapter.pain.title, chapter.pain.body);
  const signal = h("div", "build-signal");
  add(signal, h("span", "", "观察信号"), h("strong", "", chapter.pain.signal));
  pain.append(signal);
  root.append(pain);

  const change = buildLessonSection("02", "最小补丁", "change", chapter.change.title);
  const file = h("div", "build-code-file");
  add(file, h("span", "", "补丁文件"), h("code", "", chapter.change.file));
  change.append(file);
  change.append(h("pre", "build-code-block", h("code", "", chapter.change.code)));
  const changeTakeaway = h("div", "build-inline-takeaway");
  add(changeTakeaway, h("strong", "", "补丁到底加了什么"), h("p", "", chapter.change.takeaway));
  change.append(changeTakeaway);
  root.append(change);

  const run = buildLessonSection("03", "看结果", "run", chapter.run.title);
  const terminal = h("div", "build-terminal");
  const terminalBar = h("div", "build-terminal-bar");
  add(terminalBar, h("span", "", ""), h("span", "", ""), h("span", "", ""), h("strong", "", "教学快照 · 非真实运行"));
  terminal.append(terminalBar);
  const output = h("div", "build-terminal-output");
  chapter.run.lines.forEach((line) => output.append(h("div", line ? "build-terminal-line" : "build-terminal-line empty", line || " ")));
  terminal.append(output);
  run.append(terminal);
  const runNote = h("div", "build-run-note");
  add(runNote, h("strong", "", "怎么读这条输出"), h("p", "", chapter.run.note));
  run.append(runNote);
  root.append(run);

  const reasoning = h("div", "build-reason-grid");
  const why = buildLessonSection("04", "为什么需要", "why", "这个零件补上了什么", chapter.why);
  const boundary = buildLessonSection("05", "能力边界", "boundary", "它能证明到哪里，不能证明什么", chapter.boundary);
  add(reasoning, why, boundary);
  root.append(reasoning);

  const quiz = buildLessonSection("06", "检查理解", "quiz", chapter.quiz.question);
  const quizIntro = h("p", "build-quiz-intro", "不要靠“看起来眼熟”过关。每个选项都有反馈，答错可以重试。");
  quiz.append(quizIntro);
  const quizMount = h("div", "build-quiz-body");
  renderBuildQuiz(chapter, quizMount);
  quiz.append(quizMount);
  root.append(quiz);

  const future = renderBuildFuture(chapter);
  if (future) root.append(future);

  const prev = $("build-prev");
  const next = $("build-next");
  const label = $("build-progress-label");
  if (prev) {
    prev.disabled = index === 0;
    prev.textContent = index === 0 ? "已是第一章" : `← 上一章：${Evolution.chapterAt(index - 1).routeLabel}`;
  }
  if (next) {
    const atEnd = index === Evolution.CHAPTERS.length - 1;
    next.textContent = atEnd ? "进入真实解剖 →" : `下一章：${Evolution.chapterAt(index + 1).routeLabel} →`;
    next.classList.toggle("is-finish", atEnd);
  }
  if (label) label.textContent = Evolution.progressLabel(index);
}

function setBuildStep(step, options = {}) {
  if (!Evolution) return;
  const numeric = Number(step);
  state.buildStep = Math.max(0, Math.min(Evolution.CHAPTERS.length - 1, Number.isFinite(numeric) ? numeric : 0));
  renderBuild();
  const settings = options && typeof options === "object" ? options : { scroll: Boolean(options) };
  if (!settings.scroll && !settings.focus) return;
  const heading = $("build-chapter-title");
  if (settings.focus) heading?.focus({ preventScroll: true });
  if (settings.scroll) $("build-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
}


function legoSelectionIds() {
  return Lego ? Lego.normalizeSelection(state.legoSelection) : [];
}

function resetLegoCurrentResult() {
  state.legoResult = null;
  state.legoPending = null;
  state.legoVisibleEvents = 0;
}

function toggleLegoComponent(id) {
  if (!Lego || state.legoRunning || !Lego.componentById(id)) return;
  const selection = new Set(state.legoSelection);
  if (selection.has(id)) selection.delete(id);
  else selection.add(id);
  state.legoSelection = selection;
  resetLegoCurrentResult();
  renderLego();
}

function loadLegoPreset(presetId) {
  if (!Lego || state.legoRunning) return;
  const preset = Lego.PRESETS.find((item) => item.id === presetId);
  if (!preset) return;
  state.legoSelection = new Set(preset.selection);
  resetLegoCurrentResult();
  renderLego();
}

function loadLegoHistoryRun(run) {
  if (!Lego || state.legoRunning || !run) return;
  state.legoSelection = new Set(run.selection);
  resetLegoCurrentResult();
  renderLego();
  $("view-lego")?.querySelector(".lego-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderLegoTask() {
  const task = Lego?.TASK;
  if (!task) return;
  if ($("lego-task-title")) $("lego-task-title").textContent = task.title;
  if ($("lego-task-prompt")) $("lego-task-prompt").textContent = task.prompt;
  if ($("lego-task-fixture")) $("lego-task-fixture").textContent = task.fixture;
  const root = $("lego-task-checks");
  if (!root) return;
  clear(root);
  task.checks.forEach((check, index) => {
    const item = h("article", "lego-task-check");
    add(item,
      h("span", "lego-task-check-index", `0${index + 1}`),
      h("div", "", h("strong", "", check.label), h("small", "", check.evidence)),
      h("span", "lego-task-check-target", index === 2 ? "exit 0" : "required"));
    root.append(item);
  });
  root.append(h("p", "lego-task-expected", `验收目标：${task.expected}`));
}

function renderLegoShelf() {
  const root = $("lego-shelf");
  if (!root || !Lego) return;
  clear(root);
  Lego.GROUPS.forEach((group) => {
    const section = h("section", "lego-shelf-group");
    const head = h("div", "lego-shelf-group-head");
    add(head, h("strong", "", group.label), h("small", "", group.hint));
    section.append(head);
    const cards = h("div", "lego-shelf-cards");
    Lego.COMPONENTS.filter((component) => component.group === group.id).forEach((component) => {
      const selected = state.legoSelection.has(component.id);
      const card = h("button", `lego-part-card accent-${component.accent}${selected ? " is-selected" : ""}`);
      card.type = "button";
      card.dataset.legoComponent = component.id;
      card.draggable = !selected && !state.legoRunning;
      card.disabled = state.legoRunning;
      card.setAttribute("aria-pressed", String(selected));
      card.setAttribute("aria-label", `${selected ? "拆下" : "装入"} ${component.name}：${component.definition}`);
      card.title = `${component.definition} ${component.enters}`;
      const headRow = h("span", "lego-part-card-head");
      add(headRow,
        h("span", "lego-part-icon", component.icon),
        h("span", "lego-part-card-name", h("strong", "", component.name), h("small", "", component.type)),
        h("span", "lego-part-card-state", selected ? "已装" : "＋"));
      const method = h("code", "lego-part-method", component.method);
      const location = h("small", "lego-part-location", component.location);
      const timing = h("small", "lego-part-timing", `介入时机 · ${component.enters}`);
      add(card, headRow, method, location, timing);
      card.addEventListener("click", () => toggleLegoComponent(component.id));
      card.addEventListener("dragstart", (event) => {
        if (state.legoRunning) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/lego-component", component.id);
        event.dataTransfer.setData("text/plain", component.id);
        card.classList.add("is-dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
      cards.append(card);
    });
    section.append(cards);
    root.append(section);
  });
}

function renderLegoPresets() {
  const root = $("lego-presets");
  if (!root || !Lego) return;
  clear(root);
  Lego.PRESETS.forEach((preset) => {
    const active = JSON.stringify(legoSelectionIds()) === JSON.stringify(Lego.normalizeSelection(preset.selection));
    const button = h("button", `lego-preset${active ? " active" : ""}`);
    button.type = "button";
    button.disabled = state.legoRunning;
    button.setAttribute("aria-pressed", String(active));
    add(button, h("strong", "", preset.label), h("small", "", preset.detail), h("span", "", active ? "当前" : "装入 →"));
    button.addEventListener("click", () => loadLegoPreset(preset.id));
    root.append(button);
  });
}

function renderLegoBrick(component, activeIds) {
  if (!component) return null;
  const selected = state.legoSelection.has(component.id);
  const active = activeIds.includes(component.id);
  const brick = h("button", `lego-brick accent-${component.accent}${selected ? " installed" : " empty"}${active ? " is-working" : ""}`);
  brick.type = "button";
  brick.dataset.legoComponent = component.id;
  brick.setAttribute("aria-pressed", String(selected));
  brick.setAttribute("aria-label", selected ? `拆下 ${component.name}` : `装入 ${component.name}`);
  brick.disabled = state.legoRunning;
  if (selected) {
    const type = h("span", "lego-brick-type", component.type);
    const remove = h("span", "lego-brick-remove", "点击拆下");
    add(brick,
      h("span", "lego-brick-top", h("span", "lego-brick-icon", component.icon), type, remove),
      h("strong", "", component.name),
      h("code", "", component.method),
      h("small", "", component.location),
      h("small", "lego-brick-timing", `介入 · ${component.enters}`),
      h("span", "lego-brick-status", active ? "● 正在参与" : "● 已接通"));
  } else {
    add(brick,
      h("span", "lego-empty-plus", "＋"),
      h("strong", "", `${component.name} · 空插槽`),
      h("small", "", component.method),
      h("span", "lego-empty-hint", "点按装入这个零件"));
  }
  brick.addEventListener("click", () => toggleLegoComponent(component.id));
  return brick;
}

function renderLegoBoard() {
  const root = $("lego-board");
  if (!root || !Lego) return;
  clear(root);
  const activeIds = state.legoRunning && state.legoPending
    ? state.legoPending.events[Math.max(0, state.legoVisibleEvents - 1)]?.actors || []
    : [];

  const model = h("article", "lego-model-base");
  add(model,
    h("div", "lego-studs", h("i", ""), h("i", ""), h("i", ""), h("i", ""), h("i", ""), h("i", "")),
    h("div", "lego-model-base-copy", h("span", "", "FIXED BASE · MODEL"), h("strong", "", "scripted-agent-v1"), h("small", "", "理解任务 + 生成下一步 · 始终存在，不可拆")),
    h("span", "lego-model-state", activeIds.includes("model") ? "生成中" : "待命"));
  root.append(model);

  const laneSpecs = [
    {
      id: "action",
      eyebrow: "ACTION PLANE",
      title: "工具动作面",
      route: "model → Tool Schema → Harness → workspace",
      components: Lego.COMPONENTS.filter((component) => component.group === "action"),
      columns: "tools",
    },
    {
      id: "runtime",
      eyebrow: "LOOP ENGINE",
      title: "决策回路",
      route: "tool_result → messages → model → next decision",
      components: Lego.COMPONENTS.filter((component) => component.group === "runtime"),
      columns: "runtime",
    },
    {
      id: "control",
      eyebrow: "CONTROL PLANE",
      title: "治理与证据",
      route: "before side effect → after run",
      components: Lego.COMPONENTS.filter((component) => component.group === "control"),
      columns: "control",
    },
  ];
  laneSpecs.forEach((lane) => {
    const section = h("section", `lego-lane lego-lane-${lane.id}`);
    const head = h("div", "lego-lane-head");
    add(head,
      h("div", "", h("span", "eyebrow", lane.eyebrow), h("h3", "", lane.title)),
      h("code", "", lane.route));
    const grid = h("div", `lego-lane-grid ${lane.columns}`);
    lane.components.forEach((component) => grid.append(renderLegoBrick(component, activeIds)));
    section.append(head, grid);
    root.append(section);
  });

  const summary = $("lego-selection-summary");
  if (summary) {
    const components = Lego.selectedComponents(state.legoSelection);
    summary.textContent = components.length
      ? `${components.length} 个可选零件 + 固定 Model · ${components.map((component) => component.name).join(" / ")}`
      : "只有固定 Model。建议先运行一次，看看没有工具时会卡在哪里。";
  }
}

function legoEventKindLabel(kind) {
  return {
    task: "任务",
    model: "模型",
    tool: "工具",
    observation: "观察",
    guardrail: "边界",
    registry: "契约",
    eval: "验收",
    system: "系统",
  }[kind] || kind;
}

function legoLog(result, visibleCount, running) {
  const log = h("div", `lego-event-log${running ? " is-running" : ""}`);
  const events = (result?.events || []).slice(0, visibleCount);
  if (!events.length) {
    log.append(h("p", "lego-log-empty", "运行后，模型回合、工具动作和 Observation 会依次出现在这里。"));
    return log;
  }
  events.forEach((event) => {
    const item = h("article", `lego-event kind-${event.kind}`);
    const meta = h("div", "lego-event-meta");
    add(meta,
      h("span", "lego-event-sequence", String(event.sequence).padStart(2, "0")),
      h("strong", "", legoEventKindLabel(event.kind)),
      event.status ? h("span", `lego-event-status status-${String(event.status).toLowerCase()}`, event.status) : null);
    add(item, meta, h("h4", "", event.title), h("p", "", event.detail));
    log.append(item);
  });
  if (running) log.append(h("div", "lego-log-cursor", "▋ 正在装配下一块…"));
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  return log;
}

function legoGovernanceRows(result) {
  return [
    {
      label: "Tool Registry",
      value: result.registryLabel,
      state: result.registryStatus === "ACTIVE" ? "good" : "warn",
    },
    {
      label: "Guardrail",
      value: result.safetyLabel,
      state: result.safetyStatus === "PASS" ? "good" : "warn",
    },
    {
      label: "Trace",
      value: result.traceStatus === "ON" ? `${result.events.length} 个可观察事件` : "系统未记录运行轨迹",
      state: result.traceStatus === "ON" ? "good" : "warn",
    },
    {
      label: "Eval",
      value: result.evalLabel,
      state: result.evalStatus === "PASS" ? "good" : result.evalStatus === "FAIL" ? "bad" : "warn",
    },
  ];
}

function renderLegoResult() {
  const root = $("lego-result");
  if (!root || !Lego) return;
  clear(root);
  const runButton = $("lego-run-button");
  const clearButton = $("lego-clear-button");
  if (runButton) {
    runButton.disabled = state.legoRunning;
    runButton.textContent = state.legoRunning ? "装配运行中…" : state.legoResult ? "▶ 再运行一次" : "▶ 运行装配";
  }
  if (clearButton) clearButton.disabled = state.legoRunning || state.legoSelection.size === 0;
  const badge = $("lego-run-badge");

  if (state.legoRunning && state.legoPending) {
    const result = state.legoPending;
    const progress = Math.min(100, (state.legoVisibleEvents / result.events.length) * 100);
    if (badge) {
      badge.textContent = `运行中 ${state.legoVisibleEvents}/${result.events.length}`;
      badge.className = "lego-run-badge is-running";
    }
    const loading = h("div", "lego-result-running");
    add(loading,
      h("div", "lego-running-copy", h("span", "lego-running-spinner", ""), h("div", "", h("strong", "", "装配正在按顺序运行"), h("p", "", "教学视图只重放确定性事件，不发起网络请求，也不执行工具。"))),
      h("div", "lego-progress-track", h("span", "", "")));
    loading.querySelector(".lego-progress-track span").style.width = `${progress}%`;
    root.append(loading, legoLog(result, state.legoVisibleEvents, true));
    return;
  }

  if (!state.legoResult) {
    if (badge) {
      badge.textContent = "尚未运行";
      badge.className = "lego-run-badge";
    }
    const guide = h("div", "lego-result-empty");
    add(guide,
      h("span", "lego-result-empty-mark", "?"),
      h("h3", "", "先空手跑一次"),
      h("p", "", "当前装配没有运行结果。建议从只有 Model 开始，再加一个零件。不要一次打开全部，否则很难判断差异来自哪里。"),
      h("div", "lego-start-steps",
        h("span", "", "01 运行空装配"),
        h("span", "", "02 只加一个零件"),
        h("span", "", "03 看 A → B")),
      h("small", "", "页面会保留最近 6 次装配，最多自动比较最近两次。"));
    root.append(guide);
    return;
  }

  const result = state.legoResult;
  if (badge) {
    badge.textContent = `${result.statusLabel} · ${result.completed}/${result.total}`;
    badge.className = `lego-run-badge is-${result.statusTone}`;
  }

  const verdict = h("div", `lego-verdict tone-${result.statusTone}`);
  const verdictScore = h("div", "lego-verdict-score");
  add(verdictScore, h("strong", "", `${result.completed}`), h("span", "", `/ ${result.total}`), h("small", "", "动作完成"));
  const verdictCopy = h("div", "lego-verdict-copy");
  add(verdictCopy,
    h("span", `lego-status-pill tone-${result.statusTone}`, result.taskStatus),
    h("h3", "", result.statusLabel),
    h("p", "", result.statusDetail));
  verdict.append(verdictScore, verdictCopy);
  root.append(verdict);

  const metrics = h("div", "lego-result-metrics");
  [
    ["模拟耗时", Lego.formatSeconds(result.estimatedMs), "非网络实测"],
    ["模型回合", String(result.modelTurns), "每一轮都读 Observation"],
    ["工具调用", String(result.toolCalls), "脚本内动作次数"],
    ["验收状态", result.evalStatus, result.evalStatus === "OFF" ? "Eval 未装配" : "按任务契约"],
  ].forEach(([label, value, note]) => {
    const item = h("article", "lego-result-metric");
    add(item, h("span", "", label), h("strong", "", value), h("small", "", note));
    metrics.append(item);
  });
  root.append(metrics);

  const checks = h("section", "lego-run-checks");
  add(checks, h("div", "lego-result-section-head", h("strong", "", "任务交付检查"), h("span", "", "不是模型自述")));
  const checkList = h("ol", "lego-check-results");
  result.checks.forEach((check) => {
    const item = h("li", check.passed ? "passed" : "failed");
    add(item,
      h("span", "lego-check-symbol", check.passed ? "✓" : "×"),
      h("div", "", h("strong", "", check.label), h("small", "", check.evidence)),
      h("span", "", check.passed ? "有证据" : "未发生"));
    checkList.append(item);
  });
  checks.append(checkList);
  root.append(checks);

  const explanation = h("section", "lego-explanation");
  add(explanation,
    h("span", "lego-explanation-label", "为什么是这个结果"),
    h("p", "", result.narrative));
  root.append(explanation);

  const governance = h("section", "lego-governance");
  add(governance, h("div", "lego-result-section-head", h("strong", "", "系统能力分账"), h("span", "", "完成 ≠ 可信")));
  legoGovernanceRows(result).forEach((row) => {
    const item = h("div", `lego-governance-row ${row.state}`);
    add(item, h("span", "lego-governance-dot", ""), h("strong", "", row.label), h("span", "", row.value));
    governance.append(item);
  });
  root.append(governance);

  const notes = h("section", "lego-governance-notes");
  add(notes, h("strong", "", "再检查一次边界"));
  const list = h("ul", "");
  result.governanceNotes.forEach((note) => list.append(h("li", "", note)));
  notes.append(list);
  root.append(notes);

  const logHead = h("div", "lego-result-section-head lego-log-head");
  add(logHead, h("strong", "", "本次事件流"), h("span", "", "教学重放"));
  root.append(logHead, legoLog(result, result.events.length, false));

  const details = h("details", "lego-cost-details");
  add(details, h("summary", "", "模拟耗时怎么算？"), h("p", "", Lego.costBasisText()), h("small", "", "它只用于比较装配复杂度，不是模型或工具的实测性能。"));
  root.append(details);
}

function legoConfigChips(run) {
  const root = h("div", "lego-config-chips");
  const ids = Lego.normalizeSelection(run?.selection || []);
  if (!ids.length) root.append(h("span", "lego-config-chip empty", "只有 Model"));
  ids.forEach((id) => {
    const component = Lego.componentById(id);
    if (!component) return;
    const chip = h("span", `lego-config-chip accent-${component.accent}`, h("i", "", component.icon), component.name);
    chip.title = `${component.method} · ${component.location}`;
    root.append(chip);
  });
  return root;
}

function legoMetricValue(metric, run, value) {
  if (metric.key === "task") return `${value} · ${run.statusLabel}`;
  if (metric.key === "safety") return run.safetyLabel;
  if (metric.key === "evidence") return run.evidenceLabel;
  return value;
}

function renderLegoCompare() {
  const root = $("lego-compare");
  if (!root || !Lego) return;
  clear(root);
  if (state.legoRuns.length < 2) {
    const empty = h("div", "lego-compare-empty");
    const a = state.legoRuns[0];
    add(empty,
      h("div", "lego-compare-empty-track",
        h("div", "", h("span", "", "A"), h("strong", "", a ? `运行 #${a.runNumber}` : "还没跑")),
        h("span", "lego-compare-arrow", "→"),
        h("div", "", h("span", "", "B"), h("strong", "", "换一个装配"))),
      h("p", "", a ? "已有一次结果。现在只改动一个零件，再次运行，就能看到同一模型下发生的变化。" : "先运行一次；再改变装配并运行第二次。这里会自动并排比较结果。"));
    if (a) {
      const snapshot = h("div", "lego-compare-preview");
      add(snapshot, legoConfigChips(a), h("span", `lego-status-pill tone-${a.statusTone}`, `${a.taskStatus} · ${a.completed}/${a.total}`));
      empty.append(snapshot);
    }
    root.append(empty);
    return;
  }

  const a = state.legoRuns[state.legoRuns.length - 2];
  const b = state.legoRuns[state.legoRuns.length - 1];
  const comparison = Lego.compareRuns(a, b);
  const runCards = h("div", "lego-compare-runs");
  [["A", a], ["B", b]].forEach(([letter, run]) => {
    const card = h("article", `lego-compare-run run-${letter.toLowerCase()}`);
    add(card,
      h("div", "lego-compare-run-head", h("span", "", letter), h("div", "", h("strong", "", `运行 #${run.runNumber}`), h("small", "", new Date(run.completedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })))),
      legoConfigChips(run),
      h("div", "lego-compare-run-result", h("strong", "", `${run.completed}/${run.total}`), h("span", `lego-status-pill tone-${run.statusTone}`, run.taskStatus)));
    runCards.append(card);
  });
  root.append(runCards);

  const table = h("div", "lego-compare-table");
  const header = h("div", "lego-compare-row lego-compare-header");
  add(header, h("span", "lego-metric-label", "指标"), h("span", "lego-metric-value", "A · 前一次"), h("span", "lego-metric-value", "B · 后一次"), h("span", "lego-metric-delta", "变化"));
  table.append(header);
  comparison.metrics.forEach((metric) => {
    const row = h("div", `lego-compare-row metric-${metric.key}`);
    add(row,
      h("strong", "lego-metric-label", metric.label),
      h("span", "lego-metric-value", legoMetricValue(metric, a, metric.a)),
      h("span", "lego-metric-value", legoMetricValue(metric, b, metric.b)),
      h("span", `lego-delta lego-metric-delta tone-${metric.tone}`, metric.delta));
    table.append(row);
  });
  root.append(table);

  const sameSelection = JSON.stringify(a.selection) === JSON.stringify(b.selection);
  const completionDelta = b.completed - a.completed;
  const durationDelta = b.estimatedSeconds - a.estimatedSeconds;
  let insight = "装配和结果都值得逐项读：完成度提高不一定意味着总成本更低，治理能力增强也不等于任务自动成功。";
  if (sameSelection) {
    insight = "两次装配相同，所有结果也相同。这说明当前沙盒是确定性的：同一装配不会因为“再跑一次”产生随机差异。";
  } else if (completionDelta > 0 && backwardGovernanceAdded(a, b)) {
    insight = `B 多完成了 ${completionDelta} 项，但模拟耗时增加了 ${durationDelta.toFixed(2)}s。这是能力与成本的明确取舍，不是单一总分。`;
  } else if (completionDelta > 0) {
    insight = `B 多完成了 ${completionDelta} 项。先确认新增零件补上了哪个具体断点，再决定是否值得保留。`;
  } else if (b.taskStatus === "PASS" && a.taskStatus === "UNVERIFIED") {
    insight = "两次的动作完成度相同，但 B 多了任务验收。这里改变的不是“能不能做”，而是“系统能不能给出可信结论”。";
  } else if (b.safetyStatus !== a.safetyStatus || b.evidenceStatus !== a.evidenceStatus) {
    insight = "动作结果没有明显变化，B 改变的是安全、证据或验收能力。不要把治理层组件误读成模型能力升级。";
  }
  const insightCard = h("div", "lego-compare-insight");
  add(insightCard, h("span", "", "怎么读这次差异"), h("p", "", insight), h("small", "", "同一脚本化模型 · 同一任务 · 确定性模拟"));
  root.append(insightCard);
}

function backwardGovernanceAdded(a, b) {
  const aIds = new Set(a.selection);
  const bIds = new Set(b.selection);
  return ["guardrail", "trace", "eval"].some((id) => !aIds.has(id) && bIds.has(id));
}

function renderLegoHistory() {
  const root = $("lego-history");
  if (!root || !Lego) return;
  clear(root);
  if (!state.legoRuns.length) {
    root.append(h("p", "lego-history-empty", "完成第一次运行后，这里会保存装配、结果和模拟耗时。刷新页面会清空记录。"));
    return;
  }
  [...state.legoRuns].reverse().forEach((run) => {
    const card = h("article", `lego-history-card tone-${run.statusTone}`);
    const head = h("div", "lego-history-head");
    add(head,
      h("span", "lego-history-number", `#${String(run.runNumber).padStart(2, "0")}`),
      h("div", "", h("strong", "", `${run.completed}/${run.total} · ${run.taskStatus}`), h("small", "", `${Lego.formatSeconds(run.estimatedMs)} · ${run.toolCalls} 次工具调用`)));
    const load = h("button", "lego-history-load", "载入装配");
    load.type = "button";
    load.disabled = state.legoRunning;
    load.addEventListener("click", () => loadLegoHistoryRun(run));
    add(card,
      head,
      legoConfigChips(run),
      h("div", "lego-history-foot", h("span", "", run.narrative), load));
    root.append(card);
  });
}

function renderLego() {
  if (!Lego) return;
  renderLegoTask();
  renderLegoShelf();
  renderLegoPresets();
  renderLegoBoard();
  renderLegoResult();
  renderLegoCompare();
  renderLegoHistory();
}

function startLegoRun() {
  if (!Lego || state.legoRunning) return;
  const result = Lego.simulateRun(legoSelectionIds());
  state.legoPending = result;
  state.legoResult = null;
  state.legoVisibleEvents = 0;
  state.legoRunning = true;
  if (state.legoTimer) clearInterval(state.legoTimer);
  renderLego();
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const tickMs = reducedMotion ? 20 : 175;
  state.legoTimer = window.setInterval(() => {
    if (!state.legoPending) return;
    state.legoVisibleEvents = Math.min(state.legoPending.events.length, state.legoVisibleEvents + 1);
    renderLegoBoard();
    renderLegoResult();
    if (state.legoVisibleEvents < state.legoPending.events.length) return;
    clearInterval(state.legoTimer);
    state.legoTimer = null;
    const completed = {
      ...state.legoPending,
      runNumber: state.legoNextRunNumber,
      completedAt: new Date().toISOString(),
    };
    state.legoNextRunNumber += 1;
    state.legoRuns.push(completed);
    if (state.legoRuns.length > 6) state.legoRuns.shift();
    state.legoResult = completed;
    state.legoPending = null;
    state.legoRunning = false;
    state.legoVisibleEvents = completed.events.length;
    renderLego();
  }, tickMs);
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


function learnGroup(summary, id) {
  return summary.groups.find((group) => group.id === id) || {
    id,
    title: id,
    subtitle: "未记录",
    description: "这一类检查没有出现在当前报告中。",
    checks: [],
    summary: { PASS: 0, FAIL: 0, SKIP: 0, UNKNOWN: 0, total: 0 },
  };
}

function learnGroupCounts(group) {
  const order = ["PASS", "FAIL", "SKIP", "UNKNOWN"];
  const parts = order
    .filter((status) => group.summary[status] > 0)
    .map((status) => `${status} ${group.summary[status]}`);
  return parts.length ? parts.join(" · ") : "没有 checks";
}

function learnGroupVerdict(group) {
  if (!group.summary.total) return "未记录";
  if (group.summary.FAIL) return `${group.summary.FAIL} 项失败`;
  if (group.summary.UNKNOWN) return `${group.summary.UNKNOWN} 项证据不足`;
  if (group.summary.SKIP) return `${group.summary.SKIP} 项未验证`;
  return `${group.summary.PASS} 项通过`;
}

function learnContext(record) {
  const contract = state.data.task_contracts?.[record.id] || null;
  const summary = Story.summarizeExperiment(record, contract);
  const grouped = Story.groupRounds(record);
  const path = Story.toolPath(record);
  const gap = Story.continuationGap(record);
  return { contract, summary, grouped, path, gap };
}

function learnJumpButton(record, label, sequence, className = "learn-inline-action") {
  const button = h("button", className, label);
  button.type = "button";
  button.addEventListener("click", () => jumpToSequence(state.runId, record.id, sequence));
  return button;
}

function learnMetric(label, value, note = "") {
  const item = h("div", "learn-metric");
  add(item, h("span", "", label), h("strong", "", value));
  if (note) item.append(h("small", "", note));
  return item;
}

function learnAnswerCard(number, label, title, body, tone = "") {
  const card = h("article", `learn-answer-card ${tone}`.trim());
  add(card, h("span", "learn-answer-number", number), h("p", "eyebrow", label), h("h3", "", title), h("p", "", body));
  return card;
}

function returnedRanges(record) {
  const ranges = [];
  Story.groupRounds(record).rounds.forEach((round) => {
    round.calls.forEach(({ result }) => {
      if (!result) return;
      const metadata = Story.parseObservationMetadata(result);
      if (metadata.returned_range && !ranges.includes(metadata.returned_range)) ranges.push(metadata.returned_range);
    });
  });
  return ranges;
}

function traceLearningFact(record, context) {
  const { path, gap, grouped } = context;
  if (!path.totalCalls) {
    return "Trace 中没有记录到工具调用；因此不能从这份报告证明工具路径已经走通。";
  }
  const ranges = returnedRanges(record);
  const rangesText = ranges.length
    ? `工具返回范围 ${ranges.map((item) => item.replace("-", "–")).join("、")}`
    : "工具结果没有记录读取范围";
  const fixtureLines = context.summary.fixture.totalLineCount;
  const fileText = fixtureLines !== null ? `，文件共 ${fixtureLines} 行` : "";
  if (gap) {
    return `Trace 记录 ${path.totalCalls} 次工具调用；${rangesText}${fileText}。Observation 给出 next_start_line=${gap.nextStartLine}，但 S${gap.nextStep} 的 model_response 中 tool_calls=[]，Loop 进入停止分支。`;
  }
  const finish = grouped.finalResponse ? "最后一条 model_response 不含 tool_calls，Loop 停止。" : "报告没有记录明确的停止响应。";
  return `Trace 记录 ${path.totalCalls} 次工具调用；${rangesText}${fileText}。${finish}`;
}

function maxReturnedLine(record) {
  let maxLine = null;
  Story.groupRounds(record).rounds.forEach((round) => {
    round.calls.forEach(({ result }) => {
      if (!result) return;
      const metadata = Story.parseObservationMetadata(result);
      const match = String(metadata.returned_range || "").match(/(\d+)\s*-\s*(\d+)/);
      if (match) maxLine = Math.max(maxLine ?? 0, Number(match[2]));
    });
  });
  return maxLine;
}

function finalResponseForStep(grouped, step) {
  const round = grouped.rounds.find((item) => item.step === step);
  return round?.responses[round.responses.length - 1] || null;
}

function renderLearnConclusion(record, context) {
  const { summary, path, gap, grouped } = context;
  const acceptance = learnGroup(summary, "acceptance");
  const constraint = learnGroup(summary, "constraint");
  const capability = learnGroup(summary, "capability");
  const integrity = learnGroup(summary, "integrity");
  const done = summary.outcome === "PASS";
  const task = summary.question || "任务契约未记录：只能展示 Trace 和 checks，不能补写任务要求。";
  const ranges = returnedRanges(record);
  const rangeText = ranges.length ? `${ranges.map((item) => item.replace("-", "–")).join("、")} 行` : "工具读取范围未记录";
  const fileLines = summary.fixture.totalLineCount;
  const readEnd = maxReturnedLine(record);
  const failedAcceptance = acceptance.checks.filter((check) => check.status === "FAIL");
  const headline = gap && readEnd !== null
    ? `它读到第 ${readEnd} 行就停了，验收因此没有完成`
    : (done ? "这次通过了，但还要分清“已验证”和“未验证”" : "任务没有通过，先定位最后一次动作和最终裁判");
  const lead = gap
    ? `Agent 读取了 ${rangeText}${fileLines !== null ? `（文件共 ${fileLines} 行）` : ""}。工具已经返回 next_start_line=${gap.nextStartLine}，但 S${gap.nextStep} 没有继续调用工具，Loop 进入停止。最终验收 ${acceptance.summary.PASS}/${acceptance.summary.total} 通过，整体 ${summary.outcome}。`
    : (done
      ? `任务最终判定为 PASS。接下来仍要检查：哪些能力被真实证据支持，哪些测试只是 SKIP，没有被验证。`
      : `Trace 记录 ${path.totalCalls} 次工具调用，最终验收 ${acceptance.summary.PASS}/${acceptance.summary.total} 通过，整体 ${summary.outcome}。不要用 Token 或调用次数替代最终裁判。`);
  const targetResponse = gap ? finalResponseForStep(grouped, gap.nextStep) : grouped.finalResponse;
  const traceSequence = targetResponse?.sequence ?? groupedFirstSequence(grouped);

  const root = h("section", "learn-step-panel learn-conclusion");
  const hero = h("article", `learn-conclusion-hero outcome-${summary.outcome.toLowerCase()}`);
  add(hero,
    h("p", "eyebrow", "STEP 01 · 先用四句话复述"),
    h("div", "learn-conclusion-top",
      statusBadge(record.passed, record.status),
      h("span", "learn-task-id", record.id),
      h("span", "learn-run-id", `run · ${currentRun()?.label || state.runId}`)),
    h("h2", "", headline),
    h("p", "learn-conclusion-lead", lead));
  hero.append(learnJumpButton(record, gap ? `在 Trace 中定位 S${gap.nextStep} 断点 →` : "直接打开真实 Trace →", traceSequence, "learn-primary-action"));
  root.append(hero);

  const story = h("ol", "learn-story-track");
  const processText = gap
    ? `Trace 记录 ${path.totalCalls} 次工具调用，读取了 ${rangeText}${fileLines !== null ? `，文件共 ${fileLines} 行` : ""}。Observation 已经把续读位置写成 next_start_line=${gap.nextStartLine}。`
    : `Trace 记录 ${path.totalCalls} 次工具调用，读取范围为 ${rangeText}。${grouped.finalResponse ? "最后一条 model_response 不含 tool_calls，Loop 停止。" : "没有记录明确的停止响应。"}`;
  const stopText = gap
    ? `S${gap.nextStep} 的 model_response 为 tool_calls=[]。Loop 把它当作 finish，而不是“任务已经完成”。`
    : (done ? "Loop 正常结束；任务是否通过由 Loop 外的 Eval 判定。" : "先回到 Trace 找最后一次模型响应和它之前的一步，确认 Loop 是怎样退出的。");
  const failedText = failedAcceptance.length
    ? failedAcceptance.map((check) => check.label).join("；")
    : "没有 FAIL 验收项";
  const judgeText = `运行结束后，Eval 检查最终答案：最终验收 ${acceptance.summary.PASS}/${acceptance.summary.total} 通过，整体 ${summary.outcome}。本次失败证据：${failedText}。`;
  [
    ["任务", "它被要求做什么？", task],
    ["过程", "Agent 实际做了什么？", processText],
    ["断点", "Loop 为什么停在这里？", stopText],
    ["裁判", "为什么最终是这个结果？", judgeText],
  ].forEach(([label, title, body], index) => {
    const item = h("li", `learn-story-item story-${index + 1}`);
    add(item,
      h("span", "learn-story-index", String(index + 1).padStart(2, "0")),
      h("div", "learn-story-copy", h("p", "eyebrow", label), h("h3", "", title), h("p", "", body)));
    story.append(item);
  });
  root.append(story);

  const boundary = h("aside", "learn-boundary-note");
  add(boundary,
    h("strong", "", "这里只读“可观察事实”"),
    h("p", "", gap
      ? "Trace 能证明：续读线索出现后，下一轮没有再次调用工具。Trace 不能证明：模型内部为什么停止。"
      : "Trace 能证明出现了哪些响应、调用和结果；它不能直接证明模型内部动机，也不能替代运行后的 checks。"));
  root.append(boundary);

  const drawer = h("details", "learn-evidence-drawer");
  const drawerSummary = h("summary", "");
  add(drawerSummary,
    h("span", "", "可选：查看这次判定的四类证据"),
    h("small", "", `${summary.counts.PASS + summary.counts.FAIL + summary.counts.SKIP + summary.counts.UNKNOWN} 项 checks · 默认折叠`));
  drawer.append(drawerSummary);
  const drawerBody = h("div", "learn-evidence-body");
  const questions = new Map([
    ["acceptance", "答案交付了吗？"],
    ["constraint", "过程走对了吗？"],
    ["capability", "能力真发生了吗？"],
    ["integrity", "实验条件真的覆盖了吗？"],
  ]);
  [acceptance, constraint, capability, integrity].forEach((group) => {
    const row = h("div", `learn-evidence-row group-${group.id}`);
    add(row,
      h("div", "", h("strong", "", group.title), h("p", "", questions.get(group.id) || group.subtitle)),
      h("strong", `learn-evidence-verdict ${group.summary.FAIL ? "is-fail" : ""}`, learnGroupVerdict(group)),
      h("code", "", learnGroupCounts(group)));
    drawerBody.append(row);
  });
  if (capability.summary.PASS && acceptance.summary.FAIL) {
    const insight = h("aside", "learn-insight");
    add(insight,
      h("span", "learn-insight-mark", "≠"),
      h("div", "",
        h("strong", "", "工具能力 PASS ≠ 任务交付 PASS"),
        h("p", "", `本次有 ${capability.summary.PASS} 项能力证据通过，说明 ${path.usedTools.join(" + ") || "工具"} 的真实调用留下了记录；但最终验收仍有 ${acceptance.summary.FAIL} 项失败，答案没有交付完整结果。`)));
    drawerBody.append(insight);
  }
  drawer.append(drawerBody);
  root.append(drawer);

  const footer = h("div", "learn-step-takeaway");
  add(footer,
    h("span", "learn-step-takeaway-label", "先记住"),
    h("p", "", "读一次运行先按“任务 → 过程 → 断点 → 裁判”复述。Token、工具次数和最终结果不是同一个问题。"));
  root.append(footer);
  return root;
}

function groupedFirstSequence(grouped) {
  return grouped.rounds[0]?.responses[0]?.sequence ?? grouped.rounds[0]?.events[0]?.sequence ?? 0;
}

function moduleById(id) {
  return state.data?.catalog?.modules?.find((module) => module.id === id) || null;
}

function componentCard(component) {
  const card = h("article", `learn-component-card component-${component.id} ${component.tone || ""}`.trim());
  card.dataset.component = component.id;
  const top = h("div", "learn-component-top");
  add(top,
    h("span", "learn-component-icon", component.icon),
    h("div", "", h("h3", "", component.title), h("p", "", component.kind)),
    h("span", `learn-component-state ${component.tone || "catalog"}`, component.stateLabel));
  card.append(top);
  const facts = h("dl", "learn-component-facts");
  [
    ["作用", component.purpose],
    ["时机", component.when],
    ["位置", component.where],
    ["本次状态", component.state],
  ].forEach(([label, value]) => {
    const row = h("div", "learn-component-fact");
    add(row, h("dt", "", label), h("dd", "", value));
    facts.append(row);
  });
  card.append(facts);
  if (component.source) {
    const source = h("div", "learn-component-source");
    add(source, h("span", "", "源码"), sourceLink(component.source));
    card.append(source);
  }
  if (component.extra) card.append(component.extra);
  return card;
}

function learnLane(title, subtitle, components) {
  const lane = h("section", "learn-component-lane");
  const head = h("header", "learn-lane-head");
  add(head, h("div", "", h("p", "eyebrow", "LEGO LANE"), h("h3", "", title)), h("p", "", subtitle));
  lane.append(head);
  const grid = h("div", "learn-component-grid");
  components.forEach((component) => grid.append(componentCard(component)));
  lane.append(grid);
  return lane;
}

function compactModule(module, fallback) {
  return module || {
    id: fallback,
    name: fallback,
    summary: "模块目录未记录这个组件，无法确认其职责。",
    source: null,
  };
}

function assemblyCard(component) {
  const card = h("details", `assembly-card tone-${component.tone || "harness"} state-${component.stateTone || "used"}`);
  card.dataset.component = component.id;
  const summary = h("summary", "assembly-card-summary");
  add(summary,
    h("span", "assembly-card-icon", component.icon),
    h("div", "assembly-card-title", h("strong", "", component.title), h("small", "", component.kind)),
    h("span", `assembly-card-state state-${component.stateTone || "used"}`, component.stateLabel),
    h("span", "assembly-card-chevron", "＋"));
  card.append(summary);

  const body = h("div", "assembly-card-body");
  [
    ["它解决什么", component.purpose],
    ["何时进入", component.when],
    ["装在哪里", component.where],
    ["本次发生", component.state],
  ].forEach(([label, value]) => {
    const fact = h("div", "assembly-fact");
    add(fact, h("dt", "", label), h("dd", "", value));
    body.append(fact);
  });
  if (component.extra) body.append(component.extra);
  if (component.source) {
    const source = h("div", "assembly-source");
    add(source, h("span", "", "源码入口"), sourceLink(component.source));
    body.append(source);
  }
  card.append(body);
  return card;
}

function assemblyConnector(label = "→") {
  return h("span", "assembly-connector", label);
}

function renderLearnComponents(record, context) {
  const { summary, grouped, path } = context;
  const run = currentRun();
  const events = record.events || [];
  const requests = grouped.rounds.flatMap((round) => round.requests);
  const responses = grouped.rounds.flatMap((round) => round.responses);
  const results = grouped.rounds.flatMap((round) => round.toolResults);
  const approvals = grouped.rounds.flatMap((round) => round.approvals);
  const compactions = grouped.rounds.flatMap((round) => round.compactions);
  const usedTools = path.usedTools
    .map((name) => state.data.catalog.tools.find((tool) => tool.name === name))
    .filter(Boolean);
  const runStarted = events.find((event) => event.event === "run_started") || null;
  const snapshot = record.context || {};
  const fixtures = summary.fixture.fixtures || [];
  const fixtureLabel = fixtures.length
    ? fixtures.map((fixture) => `${fixture.path}${fixture.lineCount !== null ? ` · ${fixture.lineCount} 行` : ""}`).join("、")
    : "fixture 未记录";
  const toolCounts = recordToolCounts(record);
  const toolNames = usedTools.map((tool) => tool.name).join(" + ") || "未使用工具";
  const toolSource = usedTools[0]?.source || moduleById("tools")?.source;
  const registrySource = usedTools[0]?.registry_source || moduleById("tools")?.source;
  const modules = ["context", "model", "loop", "tools", "approval", "compaction", "trace", "eval"].reduce((map, id) => {
    map[id] = compactModule(moduleById(id), id);
    return map;
  }, {});
  const finalResponse = grouped.finalResponse;
  const finishRound = [...grouped.rounds].reverse().find((round) => round.branch.type === "finish");
  const successResults = results.filter((result) => result.ok !== false).length;
  const failedResults = results.filter((result) => result.ok === false).length;
  const compactionTriggered = compactions.some((event) => event.compacted);

  const toolWiring = h("div", "assembly-tool-wiring");
  add(toolWiring, h("span", "assembly-wire-label", "调用方式"));
  toolWiring.append(h("code", "", usedTools[0]?.architecture || "model tool_calls → Agent Loop → Approval? → ToolRegistry → handler → observation"));
  if (usedTools.length) {
    usedTools.forEach((tool) => {
      const toolRow = h("div", "assembly-used-tool");
      add(toolRow,
        h("strong", "", `${tool.name} ×${toolCounts[tool.name] || 0}`),
        h("span", "", `${tool.risk === "read" ? "只读" : tool.risk === "write" ? "写入" : "执行"} · ${tool.requires_approval ? "需审批" : "无需审批"}`),
        h("p", "", tool.description || "工具描述未记录"));
      if (tool.registry_source) {
        add(toolRow,
          h("span", "assembly-wire-label", "registry"),
          sourceLink(tool.registry_source),
          h("span", "assembly-wire-label", "handler"),
          sourceLink(tool.source));
      }
      toolWiring.append(toolRow);
    });
  } else {
    toolWiring.append(h("p", "assembly-empty", "这次 Trace 没有真实的 tool_call，因此工具插槽没有执行。"));
  }

  const approvalState = approvals.length
    ? `记录 ${approvals.length} 个审批或参数拒绝事件；${approvals.map((event) => Story.observationSummary(event)).join(" ")}`
    : (usedTools.length && usedTools.every((tool) => tool.requires_approval === false)
      ? `未触发。本次 ${usedTools.map((tool) => tool.name).join(" + ")} 在 registry 中标记为只读、无需审批。`
      : "Trace 没有 approval 记录；这不等于证明审批发生过或没有发生。");

  const taskCard = {
    id: "task",
    icon: "P",
    title: "Task Prompt + Fixture",
    kind: "主轨起点 · 任务输入",
    tone: "input",
    stateTone: "used",
    stateLabel: "本次已加载",
    purpose: "把目标、允许/禁止的工具、固定文件和验收条件交给 Agent。它决定这次实验到底在测什么。",
    when: "运行开始前，只加载一次",
    where: `任务契约 data.json · ${fixtureLabel}`,
    state: summary.hasContract
      ? `任务正文已记录；固定文件 ${fixtureLabel}。最终验收会检查答案是否满足这份契约。`
      : "任务契约未记录；页面不会补写目标或评分标准。",
    source: null,
  };

  const contextCard = {
    id: "context",
    icon: "C",
    title: modules.context.name,
    kind: "主轨 · 请求前快照",
    tone: "harness",
    stateTone: "used",
    stateLabel: `${requests.length} 次快照`,
    purpose: "记录这一轮模型实际看到多少消息、字符和工具 Observation。它是上下文仪表，不是模型本身。",
    when: "每次 model_request 前组装并记录",
    where: modules.context.source ? `${modules.context.source.path}:${modules.context.source.line || "?"}` : "源码位置未记录",
    state: `${requests.length} 次请求；峰值 ${formatNumber(snapshot.peak_context_chars)} 字符、${formatNumber(snapshot.peak_prompt_tokens)} prompt tokens。字符指标不等于 Token。`,
    source: modules.context.source,
  };

  const modelCard = {
    id: "model",
    icon: "M",
    title: modules.model.name,
    kind: "主轨 · 模型判断",
    tone: "model",
    stateTone: "used",
    stateLabel: `${responses.length} 次响应`,
    purpose: "读取消息和工具 Schema，返回文本或结构化 tool_calls。模型提出“下一步做什么”，但不亲自执行工具。",
    when: "每一轮决策时",
    where: modules.model.source ? `${modules.model.source.path}:${modules.model.source.line || "?"}` : "源码位置未记录",
    state: `${run?.model || "模型未记录"} 返回 ${responses.length} 次响应；是否请求工具，以 response.tool_calls 的结构为准。`,
    source: modules.model.source,
  };

  const loopCard = {
    id: "loop",
    icon: "L",
    title: modules.loop.name,
    kind: "主轨控制器 · 循环",
    tone: "harness",
    stateTone: "used",
    stateLabel: `${grouped.rounds.length} 轮`,
    purpose: "把模型响应、工具执行、Observation 回写和停止条件串成循环。它执行 Harness 规则，不替模型生成答案。",
    when: "整个运行期间持续控制每一轮",
    where: modules.loop.source ? `${modules.loop.source.path}:${modules.loop.source.line || "?"}` : "源码位置未记录",
    state: `${grouped.rounds.filter((round) => round.branch.type === "tool").length} 个工具分支、${grouped.rounds.filter((round) => round.branch.type === "finish").length} 个停止分支；共 ${grouped.rounds.length} 轮。`,
    source: modules.loop.source,
  };

  const finishCard = {
    id: "finish",
    icon: "F",
    title: "Finish / Stop",
    kind: "主轨出口 · 停止分支",
    tone: "finish",
    stateTone: "used",
    stateLabel: finishRound ? `S${finishRound.step} 停止` : "停止点未记录",
    purpose: "当 model_response 没有 tool_calls，或达到步数/异常边界时退出 Loop。停止只代表流程结束，不代表任务通过。",
    when: "模型不再请求工具时；或触发 max_steps / error",
    where: modules.loop.source ? `由 ${modules.loop.source.path}:${modules.loop.source.line || "?"} 控制` : "Loop 源码位置未记录",
    state: finishRound
      ? `S${finishRound.step} 的 model_response 为 tool_calls=[]，Loop 进入 finish；最终结果由运行后的 Eval 另行判定。`
      : "当前 Trace 没有记录明确的 finish 分支。",
    source: null,
  };

  const toolCard = {
    id: "tool-registry",
    icon: "T",
    title: `Tool Registry · ${toolNames}`,
    kind: "条件插件 · 工具能力",
    tone: "tool",
    stateTone: usedTools.length ? "used" : "idle",
    stateLabel: usedTools.length ? `调用 ${path.totalCalls} 次` : "本次未触发",
    purpose: "把模型提出的 tool_call 变成受参数校验的实际执行，再把结果作为 Observation 写回消息历史。",
    when: "model_response 含有 tool_calls 时，在下一轮模型请求之前",
    where: registrySource
      ? `registry ${registrySource.path}:${registrySource.line || "?"} · handler ${toolSource ? `${toolSource.path}:${toolSource.line || "?"}` : "未记录"}`
      : "registry 位置未记录",
    state: usedTools.length
      ? `${toolNames} 实际执行 ${path.totalCalls} 次；${results.length} 个 tool_result（${successResults} 成功 / ${failedResults} 失败）。`
      : "当前任务没有调用任何工具。",
    extra: toolWiring,
    source: null,
  };

  const approvalCard = {
    id: "approval",
    icon: "A",
    title: modules.approval.name,
    kind: "条件插件 · 安全闸门",
    tone: "guardrail",
    stateTone: approvals.length ? "used" : "idle",
    stateLabel: approvals.length ? "本次触发" : "本次未触发",
    purpose: "在写入或执行型工具真正执行前检查 Harness 策略。审批是策略闸门，不等同于系统隔离。",
    when: "工具需要审批时，位于 Loop 与 Tool handler 之间",
    where: modules.approval.source ? `${modules.approval.source.path}:${modules.approval.source.line || "?"}` : "源码位置未记录",
    state: approvalState,
    source: modules.approval.source,
  };

  const compactionCard = {
    id: "compaction",
    icon: "H",
    title: modules.compaction.name,
    kind: "条件插件 · 上下文改写",
    tone: "state",
    stateTone: compactionTriggered ? "used" : "idle",
    stateLabel: compactionTriggered ? "本次已压缩" : "本次未触发",
    purpose: "当上下文达到阈值时，在下一轮模型请求前压缩旧历史，同时尽量保留任务证据。",
    when: "每轮请求前检查；达到配置阈值才改写上下文",
    where: modules.compaction.source ? `${modules.compaction.source.path}:${modules.compaction.source.line || "?"}` : "源码位置未记录",
    state: runStarted?.compaction_strategy === "off"
      ? `策略 off；记录 ${compactions.length} 个 history_compaction 检查事件，本次没有改写上下文。`
      : `策略 ${runStarted?.compaction_strategy || "未记录"}；记录 ${compactions.length} 个历史压缩事件。`,
    source: modules.compaction.source,
  };

  const traceCard = {
    id: "trace",
    icon: "E",
    title: modules.trace.name,
    kind: "旁路证据 · 运行记录仪",
    tone: "evidence",
    stateTone: "evidence",
    stateLabel: `${events.length} 条事件`,
    purpose: "在事件发生时如实记录模型响应、工具调用、Observation 和结束状态。它不参与决策。",
    when: "事件发生时持续记录，运行结束后仍可回放",
    where: modules.trace.source ? `${modules.trace.source.path}:${modules.trace.source.line || "?"}` : "源码位置未记录",
    state: `当前任务有 ${events.length} 条结构化事件，是 Story、Replay 和本页展示的共同证据源。`,
    source: modules.trace.source,
  };

  const totalChecks = summary.counts.PASS + summary.counts.FAIL + summary.counts.SKIP + summary.counts.UNKNOWN;
  const evalCard = {
    id: "eval",
    icon: "V",
    title: modules.eval.name,
    kind: "旁路证据 · Loop 外裁判",
    tone: "evidence",
    stateTone: "evidence",
    stateLabel: `${totalChecks} 项 checks`,
    purpose: "运行结束后检查最终答案和 Trace，回答任务是否交付、过程是否合规、能力是否发生、实验是否完整。",
    when: "任务结束后；不进入模型的上下文，也不影响 Loop 选择",
    where: modules.eval.source ? `${modules.eval.source.path}:${modules.eval.source.line || "?"}` : "源码位置未记录",
    state: `PASS ${summary.counts.PASS} / FAIL ${summary.counts.FAIL} / SKIP ${summary.counts.SKIP} / UNKNOWN ${summary.counts.UNKNOWN}；整体 ${summary.outcome}。`,
    source: modules.eval.source,
  };

  const root = h("section", "learn-step-panel learn-components");
  const intro = h("div", "learn-step-heading");
  add(intro,
    h("div", "", h("p", "eyebrow", "STEP 02 · 认零件"), h("h2", "", "先看主轨，再把条件插件和裁判逐个装上")),
    h("p", "", "卡片默认收起。先读名称与本次状态，想知道“它做什么、何时进入、装在哪里”时再点开。"));
  root.append(intro);

  const board = h("section", "learn-assembly-board");
  const legend = h("div", "assembly-legend");
  [
    ["model", "模型判断"],
    ["harness", "Harness 控制"],
    ["tool", "工具能力"],
    ["evidence", "外部证据"],
    ["idle", "本次未触发"],
  ].forEach(([tone, label]) => legend.append(h("span", `assembly-legend-item legend-${tone}`, label)));
  board.append(legend);

  board.append(h("div", "assembly-section-label", "主轨 · 每次运行都会经过"));
  const mainTrack = h("div", "assembly-main");
  [taskCard, contextCard, modelCard, loopCard, finishCard].forEach((component, index) => {
    if (index) mainTrack.append(assemblyConnector());
    mainTrack.append(assemblyCard(component));
  });
  board.append(mainTrack);
  board.append(h("div", "assembly-return-note",
    h("span", "", "↺"),
    h("p", "", "如果模型返回 tool_calls：进入工具插件，执行结果作为 Observation 写回历史，然后开始下一轮 Model。没有 tool_calls：走向 Finish。")));

  board.append(h("div", "assembly-section-label", "条件插件 · 只有满足条件才进入"));
  const conditionGrid = h("div", "assembly-condition-grid");
  conditionGrid.append(assemblyCard(toolCard), assemblyCard(approvalCard), assemblyCard(compactionCard));
  board.append(conditionGrid);

  board.append(h("div", "assembly-section-label", "旁路证据 · 不替 Agent 做决定"));
  const evidenceGrid = h("div", "assembly-evidence-grid");
  evidenceGrid.append(assemblyCard(traceCard), assemblyCard(evalCard));
  board.append(evidenceGrid);
  root.append(board);

  const boundary = h("aside", "learn-boundary-note");
  add(boundary,
    h("strong", "", "判断“是否参与”，看触发和状态"),
    h("p", "", "组件出现在目录里，只说明它可用；只有 Trace 记录了调用、Observation、审批或压缩事件，才能说它本次真的进入了路径。"));
  root.append(boundary);
  return root;
}

function responseForRound(round) {
  return round.responses[round.responses.length - 1] || null;
}

function renderLearnObservation(record, entry) {
  const observation = h("div", "learn-loop-node observation");
  const result = entry.result;
  add(observation, h("span", "learn-loop-node-kind", "OBSERVATION"), h("h4", "", result ? (result.ok === false ? "工具返回失败" : "Observation 写回") : "没有关联 Observation"));
  observation.append(h("p", "", result ? Story.observationSummary(result) : "只有 tool_call，没有找到配对的 tool_result。"));
  if (result) {
    const meta = Story.parseObservationMetadata(result);
    if (meta.next_start_line !== null || meta.file_has_more !== null) {
      const fields = h("div", "learn-observation-fields");
      if (meta.returned_range) fields.append(h("code", "", `returned_range=${meta.returned_range}`));
      if (meta.has_more !== null) fields.append(h("code", "", `has_more=${meta.has_more}`));
      if (meta.file_has_more !== null) fields.append(h("code", "", `file_has_more=${meta.file_has_more}`));
      if (meta.next_start_line !== null) fields.append(h("code", "", `next_start_line=${meta.next_start_line}`));
      observation.append(fields);
    }
    observation.append(learnJumpButton(record, `定位 S${result.step ?? "?"} tool_result`, result.sequence));
  }
  return observation;
}

function renderLearnLoop(record, context) {
  const { grouped, gap } = context;
  const root = h("section", "learn-step-panel learn-loop");
  const intro = h("div", "learn-step-heading");
  add(intro,
    h("div", "", h("p", "eyebrow", "STEP 03 · 看循环"), h("h2", "", "先看这三轮做了什么，再展开原始 Trace")),
    h("p", "", "一句话规则：有 tool_calls 就执行工具，并把 Observation 写回下一轮；tool_calls=[] 就退出 Loop。规则本身不负责判断任务有没有完成。"));
  root.append(intro);

  const rule = h("div", "learn-loop-rule");
  add(rule,
    h("span", "", "IF"),
    h("strong", "", "tool_calls 非空 → 工具 → Observation → 下一轮"),
    h("span", "", "ELSE"),
    h("strong", "", "tool_calls=[] → finish，交给 Eval 判结果"));
  root.append(rule);

  const visibleRounds = grouped.rounds;
  const summaryCallout = h("aside", `loop-summary-callout ${gap ? "is-gap" : ""}`.trim());
  add(summaryCallout,
    h("span", "loop-summary-callout-label", gap ? "这次的真实断点" : "这次的真实路径"),
    h("strong", "", gap
      ? `S${gap.fromStep} 已经拿到第 ${gap.nextStartLine} 行的续读线索，S${gap.nextStep} 却没有继续请求工具。`
      : `本次共 ${visibleRounds.length} 轮；每一轮都由 model_response 的 tool_calls 决定走向。`),
    h("p", "", gap
      ? `工具返回 ${gap.returnedRange.replace("-", "–")} 行，file_has_more=true。下一轮 tool_calls=[]，Loop 进入 finish；最终答案随后由 Eval 判为 ${context.summary.outcome}。`
      : "这里只描述 Trace 中出现的动作和字段。动作后的任务结果，要等运行结束后的 checks 才成立。"));
  root.append(summaryCallout);

  const board = h("section", "loop-summary-board");
  const boardHead = h("header", "loop-summary-board-head");
  add(boardHead,
    h("div", "", h("p", "eyebrow", "OBSERVED ROUNDS"), h("h3", "", `真实发生了 ${visibleRounds.length} 轮`)),
    h("span", "", "S = 模型轮次，不是测试项"));
  board.append(boardHead);

  const cards = h("div", "loop-summary-grid");
  visibleRounds.forEach((round) => {
    const isBreakpoint = Boolean(gap && round.step === gap.nextStep);
    const response = responseForRound(round);
    const card = h("article", `loop-summary-card branch-${round.branch.type} ${isBreakpoint ? "is-breakpoint" : ""}`.trim());
    const head = h("header", "loop-summary-card-head");
    add(head,
      h("span", "loop-summary-round", `S${round.step}`),
      h("div", "", h("strong", "", round.branch.type === "finish" ? "停止" : "工具回环"), h("small", "", isBreakpoint ? "可观察断点" : `第 ${round.step} 轮`)),
      h("span", `learn-branch-badge ${round.branch.type}`, BRANCH_LABELS[round.branch.type] || round.branch.type));
    card.append(head);

    const chain = h("div", "loop-summary-chain");
    const decision = h("div", "loop-summary-chain-node decision");
    add(decision,
      h("span", "", "01 · 模型判断"),
      h("strong", "", round.calls.length ? `请求 ${round.calls.map((entry) => entry.call.tool || "unknown").join(" + ")}` : "tool_calls=[]"));
    chain.append(decision, h("span", "loop-summary-down", "↓"));

    if (round.branch.type === "finish") {
      const finish = h("div", "loop-summary-chain-node finish");
      add(finish, h("span", "", "02 · Loop 控制"), h("strong", "", "进入 finish / stop"));
      chain.append(finish);
    } else {
      const tools = h("div", "loop-summary-chain-node tool");
      add(tools,
        h("span", "", "02 · 工具执行"),
        h("strong", "", round.calls.map((entry) => Story.argumentSummary(entry.call)).join("；") || "没有可展示的参数"));
      chain.append(tools, h("span", "loop-summary-down", "↓"));
      const observations = h("div", "loop-summary-chain-node observation");
      const evidence = round.calls.map((entry) => {
        if (!entry.result) return "没有配对的 tool_result";
        return Story.observationSummary(entry.result);
      }).join(" ");
      add(observations, h("span", "", "03 · Observation"), h("strong", "", compactText(evidence, 150)));
      chain.append(observations);
    }
    card.append(chain);

    const resultLine = round.branch.type === "finish"
      ? "没有 tool_calls，所以 Loop 停止；这只证明流程结束，不证明答案正确。"
      : isBreakpoint && gap
        ? `返回 next_start_line=${gap.nextStartLine}，但下一轮没有消费它。`
        : "Observation 写入消息历史，供下一轮模型请求使用。";
    card.append(h("p", "loop-summary-result", resultLine));
    if (response) card.append(learnJumpButton(record, `定位 S${round.step} →`, response.sequence));
    cards.append(card);
  });
  if (!visibleRounds.length) cards.append(h("div", "no-data", "当前任务没有带 step 的模型轮次，无法重建 Loop。"));
  board.append(cards);
  root.append(board);

  const boundary = h("aside", "learn-boundary-note");
  add(boundary,
    h("strong", "", "这里说“接力”，不说“因为”"),
    h("p", "", "字段出现、结果回写和下一轮响应都可以被 Trace 证明；模型内部为什么选择停止，没有被记录，也不能从这些字段补写。"));
  root.append(boundary);

  const drawer = h("details", "loop-trace-drawer");
  const drawerSummary = h("summary", "");
  add(drawerSummary,
    h("span", "", "展开逐步真实 Trace"),
    h("small", "", `${grouped.rounds.length} 轮 · ${record.events?.length || 0} 个事件 · 原始参数与字段`));
  drawer.append(drawerSummary);
  const drawerBody = h("div", "loop-trace-body");
  drawerBody.append(machineTrace(record, context));
  drawer.append(drawerBody);
  root.append(drawer);
  return root;
}

function machineTrace(record, context) {
  const { grouped, gap } = context;
  const machine = h("div", "learn-loop-machine");
  const taskNode = h("div", "learn-loop-task");
  add(taskNode,
    h("span", "learn-loop-task-badge", "TASK"),
    h("div", "", h("strong", "", record.id), h("p", "", context.summary.question || "任务契约未记录")));
  machine.append(taskNode);

  grouped.rounds.forEach((round, index) => {
    if (gap && round.step === gap.nextStep && index > 0) {
      const gapCard = h("aside", "learn-gap-callout");
      add(gapCard,
        h("span", "learn-gap-label", "可观察断点"),
        h("h3", "", `第 ${gap.nextStartLine} 行已经出现，但下一次响应没有请求工具`),
        h("p", "", `S${gap.fromStep} 的 Observation 返回第 ${gap.returnedRange.replace("-", "–")} 行，file_has_more=true，next_start_line=${gap.nextStartLine}，文件共 ${gap.totalLines ?? "?"} 行。S${gap.nextStep} 的 model_response 中 tool_calls=[]，Loop 进入 finish。`),
        h("p", "learn-gap-boundary", "Trace 只能证明字段已经出现、下一轮没有消费它；没有记录模型为什么停止。"));
      machine.append(gapCard);
    }

    const response = responseForRound(round);
    const card = h("article", `learn-loop-round branch-${round.branch.type}`);
    const header = h("header", "learn-loop-round-head");
    const roundTitle = round.branch.type === "finish"
      ? "模型没有请求工具，Loop 停止"
      : (round.calls.length ? `模型请求 ${round.calls.map((entry) => entry.call.tool || "unknown").join(" + ")}` : "本轮没有可展示的决策");
    add(header,
      h("span", "learn-round-number", `S${round.step}`),
      h("div", "", h("p", "", "MODEL DECISION"), h("h3", "", roundTitle)),
      h("span", `learn-branch-badge ${round.branch.type}`, BRANCH_LABELS[round.branch.type] || round.branch.type));
    card.append(header);

    const flow = h("div", "learn-loop-flow");
    const decision = h("div", "learn-loop-node decision");
    add(decision,
      h("span", "learn-loop-node-kind", "MODEL RESPONSE"),
      h("h4", "", round.calls.length ? "tool_calls 非空" : "tool_calls=[]"),
      h("p", "", round.calls.length
        ? round.calls.map((entry) => `${entry.call.tool} · ${Story.argumentSummary(entry.call)}`).join("；")
        : compactText(response?.content || "没有记录最终文本", 220)));
    if (response) decision.append(learnJumpButton(record, `定位 S${round.step} model_response`, response.sequence));
    flow.append(decision);

    if (round.branch.type === "finish") {
      flow.append(h("span", "learn-loop-arrow", "→"));
      const finish = h("div", "learn-loop-node finish");
      add(finish,
        h("span", "learn-loop-node-kind", "CONTROL"),
        h("h4", "", "Finish / Stop"),
        h("p", "", "这条 model_response 不含 tool_calls。它是本次停止的结构证据，不代表任务已经验收通过。"));
      flow.append(finish);
    } else {
      flow.append(h("span", "learn-loop-arrow", "→"));
      if (round.calls.length) {
        const observations = h("div", "learn-observation-stack");
        round.calls.forEach((entry) => observations.append(renderLearnObservation(record, entry)));
        flow.append(observations);
      } else {
        const missing = h("div", "learn-loop-node error");
        add(missing, h("span", "learn-loop-node-kind", "EVIDENCE"), h("h4", "", "没有可展示的分支"), h("p", "", "本轮既没有 tool_call，也没有无 tool_calls 的 model_response。"));
        flow.append(missing);
      }
    }
    card.append(flow);

    if (index < grouped.rounds.length - 1) {
      const bridge = h("div", "learn-loop-bridge");
      add(bridge, h("span", "", "↓"), h("strong", "", "Observation 写入消息历史"), h("span", "", "→"), h("strong", "", `构造 S${grouped.rounds[index + 1].step} model_request`));
      card.append(bridge);
    }
    machine.append(card);
  });
  if (!grouped.rounds.length) machine.append(h("div", "no-data", "当前任务没有带 step 的模型轮次，无法重建 Loop。"));
  return machine;
}

function testGroupQuestion(group) {
  const questions = {
    acceptance: "最终答案有没有交付任务要求的全部证据？",
    constraint: "执行路径有没有绕过允许或禁止的约束？",
    capability: "工具是否真的执行，并留下了成功 Observation？",
    integrity: "实验条件是否真正触发，结论能不能复核？",
  };
  return questions[group.id] || group.subtitle || group.description;
}

function testGroupProves(group) {
  const proves = {
    acceptance: "最终响应是否满足逐项验收条件。",
    constraint: "Trace 中是否出现禁用路径或允许路径违规。",
    capability: "被检查的工具调用和结果是否真实发生。",
    integrity: "配置要求的事件或跳条件是否在本 Trace 中出现。",
  };
  return proves[group.id] || group.description;
}

function testGroupCannotProve(group) {
  const limits = {
    acceptance: "不能证明过程合规、效率高，或模型理解了任务。",
    constraint: "不能证明答案正确；没违规也不等于交付完成。",
    capability: "不能证明任务通过；没调用也不等于模型永远没有这种能力。",
    integrity: "SKIP 不是 PASS；也不能证明未触发机制本身有效。",
  };
  return limits[group.id] || "不能外推到没有检查的条件或没有记录的动机。";
}

function testGroupTone(group) {
  if (group.summary.FAIL) return "fail";
  if (group.summary.UNKNOWN) return "unknown";
  if (group.summary.SKIP) return "skip";
  if (group.summary.PASS) return "pass";
  return "unknown";
}

function renderLearnTestDossier(group) {
  const dossier = h("details", `learn-test-dossier test-${group.id} ${group.summary.FAIL ? "has-failure" : ""}`.trim());
  const summary = h("summary", "");
  add(summary,
    h("div", "", h("strong", "", group.title), h("small", "", testGroupQuestion(group))),
    h("code", "", learnGroupCounts(group)),
    h("span", "", group.checks.length ? `逐条看 ${group.checks.length} 项 →` : "没有 check"));
  dossier.append(summary);
  const body = h("div", "learn-test-dossier-body");
  body.append(h("p", "", group.description));
  if (!group.checks.length) {
    body.append(h("p", "brief-check-empty", "这一类没有 check；未记录不等于验证通过。"));
    dossier.append(body);
    return dossier;
  }
  const list = h("div", "learn-check-list");
  group.checks.forEach((check) => {
    const row = h("div", "learn-check-row");
    const topRow = h("div", "learn-check-row-top");
    add(topRow, checkBadge(check), h("strong", "", check.label));
    add(row,
      topRow,
      h("p", "", check.purpose),
      h("p", "learn-check-prevents", `防住：${check.prevents}`),
      h("code", "", check.check));
    if (check.skipReason) row.append(h("p", "check-skip-reason", check.skipReason));
    list.append(row);
  });
  body.append(list);
  dossier.append(body);
  return dossier;
}

function renderLearnTests(record, context) {
  const { summary, path } = context;
  const acceptance = learnGroup(summary, "acceptance");
  const integrity = learnGroup(summary, "integrity");
  const root = h("section", "learn-step-panel learn-tests");
  const intro = h("div", "learn-step-heading");
  add(intro,
    h("div", "", h("p", "eyebrow", "STEP 04 · 懂测试"), h("h2", "", "四类测试，其实在回答四个不同的问题")),
    h("p", "", "先把四类问题分开，再看每一条 check。最终验收决定答案是否交付；过程、能力和完整性回答另外三件事。任何单一指标都不能替代这四类裁判。"));
  root.append(intro);

  const direct = h("aside", `learn-test-direct result-${testGroupTone(acceptance)}`);
  add(direct,
    h("span", "", "先看结果"),
    h("strong", "", acceptance.summary.FAIL
      ? `整体 ${summary.outcome} 的直接原因：最终验收有 ${acceptance.summary.FAIL} 项 FAIL。`
      : `最终验收为 ${learnGroupVerdict(acceptance)}，整体 ${summary.outcome}。`),
    h("p", "", acceptance.summary.FAIL
      ? `不是 ${integrity.summary.SKIP ? "SKIP、Token 或工具成功次数" : "其他过程指标"}把任务判输；是最终答案没有满足验收证据。逐条失败项在下方“最终验收”抽屉里。`
      : "仍然要分开阅读过程、能力与完整性，不能把整页压成一个总分。"));
  root.append(direct);

  const wrap = h("div", "learn-test-table-wrap");
  const table = h("table", "learn-test-table");
  const thead = h("thead");
  const headRow = h("tr");
  ["类别", "它在问什么", "本次结果", "能证明", "不能证明"].forEach((label) => headRow.append(h("th", "", label)));
  thead.append(headRow);
  table.append(thead);
  const tbody = h("tbody");
  summary.groups.forEach((group) => {
    const row = h("tr", `group-${group.id} result-${testGroupTone(group)}`);
    const category = h("td");
    add(category, h("strong", "", group.title), h("small", "", group.subtitle));
    const question = h("td");
    question.dataset.label = "它在问什么";
    question.append(document.createTextNode(testGroupQuestion(group)));
    const result = h("td");
    result.dataset.label = "本次结果";
    result.append(h("span", `learn-test-result result-${testGroupTone(group)}`, learnGroupVerdict(group)), h("small", "", learnGroupCounts(group)));
    const proves = h("td");
    proves.dataset.label = "能证明";
    proves.append(document.createTextNode(testGroupProves(group)));
    const cannot = h("td");
    cannot.dataset.label = "不能证明";
    cannot.append(document.createTextNode(testGroupCannotProve(group)));
    add(row, category, question, result, proves, cannot);
    tbody.append(row);
  });
  table.append(tbody);
  wrap.append(table);
  root.append(wrap);

  const dossiers = h("section", "learn-test-dossiers");
  const dossiersHead = h("div", "learn-test-dossiers-head");
  add(dossiersHead,
    h("div", "", h("p", "eyebrow", "CHECK EVIDENCE"), h("h3", "", "哪一条检查真正进入了判定？")),
    h("p", "", "默认折叠。需要追证据时，再展开对应类别。"));
  dossiers.append(dossiersHead);
  summary.groups.forEach((group) => dossiers.append(renderLearnTestDossier(group)));
  root.append(dossiers);

  const reference = h("details", "learn-test-reference");
  reference.append(h("summary", "", "可选：看懂 PASS / FAIL / SKIP / UNKNOWN 和本次指标"));
  const referenceBody = h("div", "learn-test-reference-body");
  const statusRule = h("div", "learn-status-rule");
  [
    ["PASS", "断言满足", "不能外推成没检查的能力也通过"],
    ["FAIL", "断言未满足", "对应问题没有被交付或发生"],
    ["SKIP", "本次没有验证", "不是通过，不能算能力证据"],
    ["UNKNOWN", "证据不足或未分类", "不是通过，也不等于失败"],
  ].forEach(([status, title, note]) => {
    const item = h("div", `learn-status-item ${STATUS_STYLE[status].className}`);
    add(item, h("strong", "", `${STATUS_STYLE[status].symbol} ${status}`), h("span", "", title), h("small", "", note));
    statusRule.append(item);
  });
  referenceBody.append(statusRule);

  const contextSnapshot = record.context || {};
  const metrics = h("div", "learn-metrics-strip");
  add(metrics,
    learnMetric("模型调用", formatNumber(contextSnapshot.model_calls ?? contextSnapshot.main_model_calls), "过程指标"),
    learnMetric("总 Token", formatNumber(contextSnapshot.total_model_tokens ?? contextSnapshot.total_tokens), "成本指标，不是评分"),
    learnMetric("工具调用", path.totalCalls, "是否真的发生"),
    learnMetric("checks", summary.counts.PASS + summary.counts.FAIL + summary.counts.SKIP + summary.counts.UNKNOWN, "裁判项总数"));
  referenceBody.append(metrics);

  const metricNote = h("aside", "learn-metric-note");
  add(metricNote,
    h("strong", "", "指标 ≠ 通过标准"),
    h("p", "", "调用次数、Token 和上下文占用解释路径与成本，不会自动把任务判成 PASS。整体结果来自 checks；其中 SKIP 只表示没有验证。"));
  referenceBody.append(metricNote);
  reference.append(referenceBody);
  root.append(reference);
  return root;
}

function learnTakeaways(record, context) {
  const { summary, path, gap } = context;
  const acceptance = learnGroup(summary, "acceptance");
  const capability = learnGroup(summary, "capability");
  const integrity = learnGroup(summary, "integrity");
  const tools = path.usedTools.join(" + ") || "本次没有工具";
  return [
    {
      title: "Agent 是一套装配，不是一颗“大模型脑”",
      body: `这次运行同时涉及任务契约、上下文、模型、Loop、${tools}、Trace 和 Eval。零件“存在于目录”不算参与，必须看本次时机和状态。`,
    },
    {
      title: "Observation 是写给下一步的数据",
      body: gap
        ? `S${gap.fromStep} 返回 next_start_line=${gap.nextStartLine}，但 S${gap.nextStep} 的 tool_calls=[]。我们能确认“线索出现后没有继续调用”，不能补写模型动机。`
        : "工具结果会被写回消息历史；字段是否被下一轮消费，要回到 Trace 逐项核对，而不是听最终答案自述。",
    },
    {
      title: "工具成功不等于任务交付",
      body: capability.summary.PASS && acceptance.summary.FAIL
        ? `能力证据 PASS ${capability.summary.PASS} 项，最终验收却 FAIL ${acceptance.summary.FAIL} 项。测试把“会不会用工具”和“有没有交付答案”分开裁判。`
        : "能力证据只回答能力是否发生；最终验收另看答案是否交付。两个结论要分开读。",
    },
    {
      title: "看到 SKIP，不要把它算成绿色 PASS",
      body: integrity.summary.SKIP
        ? `实验完整性有 ${integrity.summary.SKIP} 项 SKIP。它表示本次没有验证该能力，不是“验证通过”，也不能支撑对应机制的结论。`
        : "本次完整性检查没有 SKIP；仍要继续区分 PASS、FAIL 与证据缺失，不能用一个总分抹平。",
    },
  ];
}

function renderLearnReview(record, context) {
  const root = h("section", "learn-step-panel learn-review");
  const intro = h("div", "learn-step-heading");
  add(intro,
    h("div", "", h("p", "eyebrow", "STEP 05 · 做复盘"), h("h2", "", "把这次运行压缩成四句能被证据支持的话")),
    h("p", "", "复盘不是再讲一遍故事，而是把机制、证据边界和测试判定留在脑子里。"));
  root.append(intro);

  const takeaways = learnTakeaways(record, context);
  const grid = h("div", "learn-takeaway-grid");
  takeaways.forEach((takeaway, index) => {
    const card = h("article", "learn-takeaway-card");
    add(card,
      h("span", "learn-takeaway-number", String(index + 1).padStart(2, "0")),
      h("h3", "", takeaway.title),
      h("p", "", takeaway.body));
    grid.append(card);
  });
  root.append(grid);

  const boundary = h("aside", "learn-boundary-note final");
  add(boundary,
    h("strong", "", "这次实验能说 / 不能说"),
    h("p", "", "能说：当前 Trace 中出现了哪些结构、工具调用和验收结果。不能说：模型内部为什么停止，或一次 A/B 差异必然由某个参数造成。"));
  root.append(boundary);

  const dive = h("section", "learn-deep-dive");
  add(dive,
    h("p", "eyebrow", "GO DEEPER · 保留原有四个证据入口"),
    h("h3", "", "现在再从不同角度拆同一条真实记录"),
    h("p", "", "先完成五步，再进入深挖；入口不会切换任务，仍围绕当前学习任务。"));
  const buttons = h("div", "learn-deep-grid");
  [
    ["story", "01", "任务故事", "沿问题、契约、Observation 和停止点读完整叙事。"],
    ["replay", "02", "Loop 回放", "逐条查看当前任务的真实事件与原始字段。"],
    ["anatomy", "03", "乐高拆解", "按代码模块和工具 registry 看装配关系。"],
    ["compare", "04", "A/B 对比", "比较运行、参数、Token、任务和 checks 差异。"],
  ].forEach(([view, number, title, detail]) => {
    const button = h("button", "learn-deep-card");
    button.type = "button";
    button.dataset.deepView = view;
    add(button,
      h("span", "learn-deep-number", number),
      h("strong", "", title),
      h("span", "", detail),
      h("small", "", "打开 →"));
    button.addEventListener("click", () => switchView(view));
    buttons.append(button);
  });
  dive.append(buttons);
  root.append(dive);
  return root;
}

function updateLearnNavigation() {
  const step = Math.max(1, Math.min(LEARN_STEPS.length, Number(state.learnStep) || 1));
  state.learnStep = step;
  document.querySelectorAll("[data-learn-step]").forEach((button) => {
    const active = Number(button.dataset.learnStep) === step;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  const meta = LEARN_STEPS[step - 1];
  const status = $("learn-step-status");
  if (status) status.textContent = `第 ${step} / ${LEARN_STEPS.length} 步 · ${meta.title}：${meta.question}`;
  const prev = $("learn-prev");
  const next = $("learn-next");
  if (prev) prev.disabled = step === 1;
  if (next) {
    next.disabled = step === LEARN_STEPS.length;
    next.textContent = step === LEARN_STEPS.length ? "已到复盘" : `下一步：${LEARN_STEPS[step].title} →`;
  }
}

function renderLearn() {
  if (!state.data || !$("learn-content")) return;
  const run = currentRun();
  const record = currentRecord();
  fillTaskSelect($("learn-task-select"), run, record?.id);
  updateLearnNavigation();
  const root = clear($("learn-content"));
  if (!record) {
    root.append(h("div", "no-data", "当前运行没有任务记录，无法开始五步学习。"));
    return;
  }
  state.taskId = record.id;
  const context = learnContext(record);
  if (state.learnStep === 1) root.append(renderLearnConclusion(record, context));
  else if (state.learnStep === 2) root.append(renderLearnComponents(record, context));
  else if (state.learnStep === 3) root.append(renderLearnLoop(record, context));
  else if (state.learnStep === 4) root.append(renderLearnTests(record, context));
  else root.append(renderLearnReview(record, context));
}

function setLearnStep(step, scroll = false) {
  state.learnStep = Math.max(1, Math.min(LEARN_STEPS.length, Number(step) || 1));
  renderLearn();
  if (scroll) {
    $("learn-stepper")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
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
  document.querySelectorAll(".learn-step, .learn-pager-button, #global-run-select, #task-select, #story-task-select, #learn-task-select, #compare-a, #compare-b, #swap-runs").forEach((element) => {
    element.disabled = disabled;
  });
}

function showEmpty() {
  state.dataState = "missing";
  syncViewVisibility();
  if (state.view === "build") renderBuild();
  if (state.view === "lego") renderLego();
  disableControls(true);
}

function showError(message) {
  state.dataState = "error";
  $("error-message").textContent = message;
  syncViewVisibility();
  if (state.view === "build") renderBuild();
  if (state.view === "lego") renderLego();
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
    state.dataState = "ready";
    const learnRun = data.runs.find((run) => run.records?.some((record) => normalizedStatus(record.passed, record.status) === "FAIL"))
      || data.runs[0];
    const learnRecord = preferredRecord(learnRun);
    state.runId = learnRun.id;
    state.taskId = learnRecord?.id || null;
    state.compareA = data.runs[0].id;
    state.compareB = data.runs[1]?.id || data.runs[0].id;
    $("empty-state").hidden = true;
    $("error-state").hidden = true;
    $("dashboard-content").hidden = false;
    disableControls(false);
    document.querySelector(".local-badge").title = `生成于 ${data.generated_at} · ${data.data_classification}`;
    renderAll();
    syncViewVisibility();
    if (state.view === "build") renderBuild();
    if (state.view === "lego") renderLego();

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
  $("lego-run-button").addEventListener("click", startLegoRun);
  $("lego-clear-button").addEventListener("click", () => {
    if (state.legoRunning) return;
    state.legoSelection = new Set();
    resetLegoCurrentResult();
    renderLego();
  });
  const legoBoard = $("lego-board");
  legoBoard.addEventListener("dragover", (event) => {
    if (state.legoRunning) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    legoBoard.classList.add("is-dragover");
  });
  legoBoard.addEventListener("dragleave", (event) => {
    if (!legoBoard.contains(event.relatedTarget)) legoBoard.classList.remove("is-dragover");
  });
  legoBoard.addEventListener("drop", (event) => {
    event.preventDefault();
    legoBoard.classList.remove("is-dragover");
    if (state.legoRunning) return;
    const id = event.dataTransfer.getData("text/lego-component") || event.dataTransfer.getData("text/plain");
    if (!id || !Lego?.componentById(id) || state.legoSelection.has(id)) return;
    state.legoSelection = new Set([...state.legoSelection, id]);
    resetLegoCurrentResult();
    renderLego();
  });
  $("build-chapter-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-build-chapter]");
    if (!button) return;
    setBuildStep(Number(button.dataset.buildChapter), { scroll: true, focus: true });
  });
  $("build-prev").addEventListener("click", () => setBuildStep(state.buildStep - 1, { scroll: true, focus: true }));
  $("build-next").addEventListener("click", () => {
    if (!Evolution) return;
    if (state.buildStep === Evolution.CHAPTERS.length - 1) switchView("learn");
    else setBuildStep(state.buildStep + 1, { scroll: true, focus: true });
  });
  $("empty-back-build").addEventListener("click", () => switchView("build"));
  $("error-back-build").addEventListener("click", () => switchView("build"));
  $("global-run-select").addEventListener("change", (event) => {
    stopPlayback();
    state.runId = event.target.value;
    state.taskId = preferredRecord(currentRun())?.id || null;
    state.eventIndex = 0;
    renderAll();
  });
  $("learn-task-select").addEventListener("change", (event) => {
    stopPlayback();
    state.taskId = event.target.value;
    state.eventIndex = 0;
    syncTaskSelects();
    renderLearn();
  });
  document.querySelectorAll("[data-learn-step]").forEach((button) => {
    button.addEventListener("click", () => setLearnStep(button.dataset.learnStep, true));
  });
  $("learn-prev").addEventListener("click", () => setLearnStep(state.learnStep - 1, true));
  $("learn-next").addEventListener("click", () => setLearnStep(state.learnStep + 1, true));
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
switchView("build");
loadData();
