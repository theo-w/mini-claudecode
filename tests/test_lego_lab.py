from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
LEGO = ROOT / "dashboard" / "lego.js"
APP = ROOT / "dashboard" / "app.js"
INDEX = ROOT / "dashboard" / "index.html"


class AgentLegoLabTests(unittest.TestCase):
    def run_lego_assertions(self, assertions: str) -> None:
        script = f"""
const assert = require('node:assert/strict');
const Lego = require({json.dumps(str(LEGO))});
{assertions}
"""
        completed = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_catalog_has_eight_located_parts_in_three_planes(self) -> None:
        self.run_lego_assertions(
            """
const expected = [
  'read_file', 'write_file', 'run_python',
  'loop', 'registry', 'guardrail', 'trace', 'eval',
];
assert.deepEqual(Lego.COMPONENTS.map((part) => part.id), expected);
assert.deepEqual(Lego.GROUPS.map((group) => group.id), ['action', 'runtime', 'control']);
assert.deepEqual(
  Lego.COMPONENTS.filter((part) => part.group === 'action').map((part) => part.id),
  ['read_file', 'write_file', 'run_python'],
);
assert.deepEqual(
  Lego.COMPONENTS.filter((part) => part.group === 'runtime').map((part) => part.id),
  ['loop', 'registry'],
);
assert.deepEqual(
  Lego.COMPONENTS.filter((part) => part.group === 'control').map((part) => part.id),
  ['guardrail', 'trace', 'eval'],
);
for (const [index, part] of Lego.COMPONENTS.entries()) {
  assert.equal(part.order, index + 1);
  for (const key of ['type', 'icon', 'name', 'method', 'location', 'definition', 'enters', 'missing', 'accent']) {
    assert.equal(typeof part[key], 'string', `${part.id}.${key} must be text`);
    assert.ok(part[key].trim().length > 0, `${part.id}.${key} must not be empty`);
  }
  assert.match(part.method, /\\(|→/);
  assert.match(part.location, /Harness|runtime|Evaluation|workspace/);
  assert.ok(part.definition.length >= 20);
  assert.ok(part.enters.length >= 12);
  assert.ok(part.missing.length >= 16);
}
"""
        )

    def test_every_assembly_has_three_independent_and_truthful_outcomes(self) -> None:
        self.run_lego_assertions(
            """
const ids = Lego.COMPONENTS.map((part) => part.id);
for (let mask = 0; mask < (1 << ids.length); mask += 1) {
  const selection = ids.filter((_, index) => mask & (1 << index));
  const run = Lego.simulateRun(selection);
  assert.deepEqual(run.outcomes.map((outcome) => outcome.key), ['task', 'boundary', 'auditability']);
  const outcomes = Object.fromEntries(run.outcomes.map((outcome) => [outcome.key, outcome]));
  assert.equal(outcomes.task.value, run.taskStatus);
  assert.equal(outcomes.boundary.value, run.safetyStatus);

  const expectedAuditability = run.traceStatus === 'ON'
    ? (run.evalStatus === 'OFF' ? 'TRACE_ONLY' : 'FULL')
    : 'NONE';
  assert.equal(outcomes.auditability.value, expectedAuditability);
  if (!selection.includes('guardrail')) {
    assert.equal(outcomes.boundary.value, 'UNKNOWN');
    assert.doesNotMatch(outcomes.boundary.detail, /已接通|已通过|PASS/);
  }
  if (!selection.includes('trace')) {
    assert.equal(outcomes.auditability.value, 'NONE');
    assert.doesNotMatch(outcomes.auditability.detail, /已有.*轨迹|轨迹.*已.*记录/);
  }
  assert.doesNotMatch(run.narrative, /动作链、执行边界、系统轨迹和任务验收都已接通/);
  if (!selection.includes('guardrail') || !selection.includes('trace')) {
    assert.match(run.narrative, /执行边界|可审计|Trace|Guardrail/);
  }
}

const evalOnly = Lego.simulateRun(['read_file', 'write_file', 'run_python', 'loop', 'eval']);
assert.equal(evalOnly.taskStatus, 'PASS');
assert.equal(evalOnly.outcomes.find((outcome) => outcome.key === 'boundary').value, 'UNKNOWN');
assert.equal(evalOnly.outcomes.find((outcome) => outcome.key === 'auditability').value, 'NONE');
assert.match(evalOnly.narrative, /任务.*通过|交付.*通过/);
assert.match(evalOnly.narrative, /执行边界.*UNKNOWN/);
assert.match(evalOnly.narrative, /可审计性.*NONE/);
"""
        )

    def test_four_presets_are_deterministic_starting_points(self) -> None:
        self.run_lego_assertions(
            """
const byId = Object.fromEntries(Lego.PRESETS.map((preset) => [preset.id, preset]));
assert.deepEqual(Object.keys(byId), ['model-only', 'one-tool', 'working', 'trusted']);
const expected = {
  'model-only': { status: 'BLOCKED', completed: 0, calls: 0, turns: 1, ms: 720, eval: 'OFF' },
  'one-tool': { status: 'INCOMPLETE', completed: 1, calls: 1, turns: 1, ms: 900, eval: 'OFF' },
  'working': { status: 'UNVERIFIED', completed: 3, calls: 3, turns: 4, ms: 3420, eval: 'OFF' },
  'trusted': { status: 'PASS', completed: 3, calls: 3, turns: 4, ms: 3884, eval: 'PASS' },
};
for (const [id, preset] of Object.entries(byId)) {
  const first = Lego.simulateRun(preset.selection);
  const second = Lego.simulateRun(preset.selection);
  assert.deepEqual(first, second, `${id} must be deterministic`);
  assert.equal(first.taskStatus, expected[id].status);
  assert.equal(first.completed, expected[id].completed);
  assert.equal(first.toolCalls, expected[id].calls);
  assert.equal(first.modelTurns, expected[id].turns);
  assert.equal(first.estimatedMs, expected[id].ms);
  assert.equal(first.evalStatus, expected[id].eval);
}
const trusted = Lego.simulateRun(byId.trusted.selection);
assert.equal(trusted.safetyStatus, 'PASS');
assert.equal(trusted.evidenceStatus, 'FULL');
assert.equal(trusted.registryStatus, 'ACTIVE');
"""
        )

    def test_read_tool_does_not_claim_write_or_test_completion(self) -> None:
        self.run_lego_assertions(
            """
const run = Lego.simulateRun(['read_file']);
assert.equal(run.taskStatus, 'INCOMPLETE');
assert.equal(run.completed, 1);
assert.deepEqual(run.checks.map((check) => check.passed), [true, false, false]);
assert.equal(run.toolCalls, 1);
assert.deepEqual(
  run.events.filter((event) => event.kind === 'tool').flatMap((event) => event.actors),
  ['read_file'],
);
assert.doesNotMatch(JSON.stringify(run.events), /write_file\\(file_path=.*saved|run_python\\(unittest\\)/);
assert.match(run.narrative, /Observation.*没有回到下一轮|只动了一下/);
"""
        )

    def test_loop_is_required_before_actions_become_a_sequence(self) -> None:
        self.run_lego_assertions(
            """
const run = Lego.simulateRun(['read_file', 'write_file', 'run_python']);
assert.equal(run.toolCalls, 1);
assert.equal(run.modelTurns, 1);
assert.equal(run.completed, 1);
assert.equal(run.taskStatus, 'INCOMPLETE');
assert.equal(run.events.find((event) => event.kind === 'system')?.status, 'BLOCKED');
assert.match(JSON.stringify(run.events), /Loop 未装配/);
"""
        )

    def test_task_pass_requires_delivery_and_separate_eval(self) -> None:
        self.run_lego_assertions(
            """
const writeOnly = Lego.simulateRun(['read_file', 'write_file', 'loop']);
assert.equal(writeOnly.completed, 2);
assert.equal(writeOnly.checks[2].passed, false);
assert.equal(writeOnly.taskStatus, 'INCOMPLETE');
assert.match(writeOnly.narrative, /没有测试 Observation|模型说完成/);

const actions = Lego.simulateRun(['read_file', 'write_file', 'run_python', 'loop']);
assert.equal(actions.completed, 3);
assert.equal(actions.taskStatus, 'UNVERIFIED');
assert.equal(actions.evalStatus, 'OFF');
assert.notEqual(actions.taskStatus, 'PASS');

const failedEval = Lego.simulateRun(['read_file', 'run_python', 'loop', 'eval']);
assert.equal(failedEval.completed, 1);
assert.equal(failedEval.evalStatus, 'FAIL');
assert.equal(failedEval.taskStatus, 'INCOMPLETE');

const passedEval = Lego.simulateRun(['read_file', 'write_file', 'run_python', 'loop', 'eval']);
assert.equal(passedEval.completed, 3);
assert.equal(passedEval.evalStatus, 'PASS');
assert.equal(passedEval.taskStatus, 'PASS');
"""
        )

    def test_guardrail_trace_and_eval_remain_independent_claims(self) -> None:
        self.run_lego_assertions(
            """
const actionsAndEval = ['read_file', 'write_file', 'run_python', 'loop', 'eval'];
const noBoundary = Lego.simulateRun(actionsAndEval);
assert.equal(noBoundary.safetyStatus, 'UNKNOWN');
assert.notEqual(noBoundary.safetyStatus, 'PASS');
assert.equal(noBoundary.evidenceStatus, 'EVAL_ONLY');
assert.notEqual(noBoundary.evidenceStatus, 'FULL');

const guarded = Lego.simulateRun([...actionsAndEval, 'guardrail']);
assert.equal(guarded.safetyStatus, 'PASS');
assert.match(guarded.safetyLabel, /3 次动作经过边界检查/);
assert.equal(guarded.evidenceStatus, 'EVAL_ONLY');

const traced = Lego.simulateRun([...actionsAndEval, 'guardrail', 'trace']);
assert.equal(traced.evidenceStatus, 'FULL');
assert.notEqual(traced.taskStatus === 'PASS' && noBoundary.taskStatus === 'PASS' && traced.evidenceStatus === noBoundary.evidenceStatus, true);

const unusedGuardrail = Lego.simulateRun(['guardrail']);
assert.equal(unusedGuardrail.safetyStatus, 'READY');
assert.notEqual(unusedGuardrail.safetyStatus, 'PASS');
const traceOnly = Lego.simulateRun(['trace']);
assert.equal(traceOnly.evidenceStatus, 'TRACE_ONLY');
assert.notEqual(traceOnly.evidenceStatus, 'FULL');
"""
        )

    def test_compare_runs_exposes_tradeoffs_without_single_score(self) -> None:
        self.run_lego_assertions(
            """
const working = Lego.simulateRun(['read_file', 'write_file', 'run_python', 'loop']);
const trusted = Lego.simulateRun(Lego.PRESETS.find((preset) => preset.id === 'trusted').selection);
const comparison = Lego.compareRuns(working, trusted);
assert.ok(comparison);
const metrics = Object.fromEntries(comparison.metrics.map((metric) => [metric.key, metric]));
assert.equal(metrics.completion.delta, '不变');
assert.equal(metrics.task.delta, '提升');
assert.equal(metrics.duration.a, '3.42s');
assert.equal(metrics.duration.b, '3.88s');
assert.equal(metrics.duration.delta, '+0.46s');
assert.equal(metrics.tools.delta, '不变');
assert.equal(metrics.safety.delta, '增强');
assert.equal(metrics.evidence.delta, '增强');
assert.equal(Lego.compareRuns(null, trusted), null);
"""
        )

    def test_compare_runs_identifies_repeat_controlled_and_multivariate_changes(self) -> None:
        self.run_lego_assertions(
            """
const empty = Lego.simulateRun([]);
const read = Lego.simulateRun(['read_file']);
const readLoopGuard = Lego.simulateRun(['read_file', 'loop', 'guardrail']);

const repeated = Lego.compareRuns(empty, empty);
assert.equal(repeated.mode, 'repeat');
assert.equal(repeated.isRepeat, true);
assert.equal(repeated.isControlled, false);
assert.deepEqual(repeated.changedComponents, []);
assert.match(repeated.summary, /重复运行/);
assert.doesNotMatch(repeated.summary, /归因给/);

const controlled = Lego.compareRuns(empty, read);
assert.equal(controlled.mode, 'controlled');
assert.equal(controlled.isRepeat, false);
assert.equal(controlled.isControlled, true);
assert.deepEqual(controlled.changedComponents, ['read_file']);
assert.deepEqual(controlled.addedComponents, ['read_file']);
assert.deepEqual(controlled.removedComponents, []);
assert.equal(controlled.warning, null);
assert.match(controlled.summary, /受控对照/);
assert.match(controlled.summary, /读取文件/);

const multivariate = Lego.compareRuns(read, readLoopGuard);
assert.equal(multivariate.mode, 'multivariate');
assert.equal(multivariate.isControlled, false);
assert.deepEqual(multivariate.changedComponents, ['loop', 'guardrail']);
assert.match(multivariate.warning, /多变量|不能.*归因/);
assert.match(multivariate.summary, /Loop|Tool Loop/);
assert.match(multivariate.summary, /执行边界/);
"""
        )

    def test_recommendations_are_minimal_single_component_next_experiments(self) -> None:
        self.run_lego_assertions(
            """
const cases = [
  [[], 'read_file'],
  [['read_file'], 'loop'],
  [['read_file', 'loop'], 'write_file'],
  [['read_file', 'loop', 'write_file'], 'run_python'],
  [['read_file', 'loop', 'write_file', 'run_python'], 'eval'],
  [['read_file', 'loop', 'write_file', 'run_python', 'eval'], 'guardrail'],
  [['read_file', 'loop', 'write_file', 'run_python', 'eval', 'guardrail'], 'trace'],
  [['read_file', 'loop', 'write_file', 'run_python', 'eval', 'guardrail', 'trace'], 'registry'],
];
for (const [selection, expectedId] of cases) {
  const recommendations = Lego.recommendNextExperiments(selection);
  assert.ok(recommendations.length >= 1 && recommendations.length <= 3);
  assert.equal(recommendations[0].componentId, expectedId);
  for (const recommendation of recommendations) {
    assert.equal(recommendation.selection.length, selection.length + 1);
    assert.ok(recommendation.selection.includes(recommendation.componentId));
    for (const id of selection) assert.ok(recommendation.selection.includes(id));
    assert.ok(recommendation.reason.length >= 12);
    assert.ok(recommendation.expected.length >= 8);
  }
}

const complete = Lego.recommendNextExperiments(Lego.COMPONENTS.map((part) => part.id));
assert.deepEqual(complete, []);
"""
        )

    def test_cost_is_explainable_monotonic_and_not_runtime_latency(self) -> None:
        self.run_lego_assertions(
            """
const chain = [
  [],
  ['read_file'],
  ['read_file', 'loop'],
  ['read_file', 'write_file', 'loop'],
  ['read_file', 'write_file', 'run_python', 'loop'],
  Lego.PRESETS.find((preset) => preset.id === 'trusted').selection,
];
const runs = chain.map((selection) => Lego.simulateRun(selection));
for (let index = 1; index < runs.length; index += 1) {
  assert.ok(runs[index].estimatedMs > runs[index - 1].estimatedMs);
}
const full = runs.at(-1);
const expected = (
  full.modelTurns * Lego.COST_MODEL.modelTurnMs
  + full.toolCalls * Lego.COST_MODEL.toolCallMs
  + full.toolCalls * Lego.COST_MODEL.guardrailPerToolMs
  + full.toolCalls * Lego.COST_MODEL.registryPerToolMs
  + Lego.COST_MODEL.traceFixedMs
  + full.events.length * Lego.COST_MODEL.traceEventMs
  + Lego.COST_MODEL.evalMs
);
assert.equal(full.estimatedMs, expected);
assert.equal(Lego.formatSeconds(full.estimatedMs), '3.88s');
const basis = Lego.costBasisText();
for (const value of Object.values(Lego.COST_MODEL)) {
  assert.match(basis, new RegExp(String(value)));
}
assert.match(basis, /教学估算/);
assert.match(basis, /Trace/);
assert.match(basis, /Eval/);
"""
        )

    def test_page_contract_is_interactive_and_has_no_real_execution_channel(self) -> None:
        self.assertTrue(LEGO.exists(), "lego.js is missing")
        self.assertTrue(APP.exists())
        self.assertTrue(INDEX.exists())
        html = INDEX.read_text(encoding="utf-8")
        app = APP.read_text(encoding="utf-8")
        lego = LEGO.read_text(encoding="utf-8")
        for token in [
            'lego.js',
            'id="tab-lego"',
            'id="view-lego"',
            'id="lego-baseline-button"',
            'id="lego-shelf"',
            'id="lego-board"',
            'id="lego-run-button"',
            'id="lego-result"',
            'id="lego-outcomes"',
            'id="lego-next-experiments"',
            'id="lego-compare"',
            'id="lego-history"',
            '先跑一次基线',
            '不调用 API · 不执行工具',
        ]:
            self.assertIn(token, html)
        for token in [
            'function toggleLegoComponent',
            'function loadLegoPreset',
            'function loadLegoHistoryRun',
            'function startLegoBaseline',
            'function applyLegoRecommendation',
            'function renderLegoBoard',
            'function renderLegoOutcomes',
            'function renderLegoRecommendations',
            'function renderLegoCompare',
            'function startLegoRun',
            'addEventListener("dragstart"',
            'addEventListener("drop"',
            'state.legoRunning',
            'runPicker.hidden',
        ]:
            self.assertIn(token, app)
        self.assertIn('缺少它时', app)
        self.assertIn('模式 === "multivariate"', app)
        self.assertIn('["工具调用", String(result.toolCalls), "脚本内动作次数"]', app)
        self.assertNotRegex(lego, r"ANTHROPIC_API_KEY|OPENAI_API_KEY|fetch\s*\(|XMLHttpRequest|WebSocket|child_process|subprocess|spawn\s*\(")
        self.assertNotRegex(html, r'<script[^>]+src=["\']https?://')


if __name__ == "__main__":
    unittest.main()
