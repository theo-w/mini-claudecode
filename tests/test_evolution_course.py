from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
EVOLUTION = ROOT / "dashboard" / "evolution.js"
APP = ROOT / "dashboard" / "app.js"
INDEX = ROOT / "dashboard" / "index.html"


class EvolutionCourseTests(unittest.TestCase):
    def run_course_assertions(self, assertions: str) -> None:
        script = f"""
const assert = require('node:assert/strict');
const Course = require({json.dumps(str(EVOLUTION))});
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

    def test_course_has_seven_ordered_single_concept_chapters(self) -> None:
        self.run_course_assertions(
            """
assert.equal(Course.CHAPTERS.length, 7);
assert.deepEqual(Course.CHAPTERS.map((chapter) => chapter.id), [
  'model-only',
  'first-tool',
  'tool-loop',
  'tool-registry',
  'safety-boundary',
  'trace',
  'eval',
]);
const requiredText = ['title', 'kicker', 'promise', 'why', 'boundary'];
for (const [index, chapter] of Course.CHAPTERS.entries()) {
  assert.equal(chapter.number, index + 1);
  for (const key of requiredText) {
    assert.equal(typeof chapter[key], 'string', `${chapter.id}.${key} must be text`);
    assert.ok(chapter[key].trim().length >= 8, `${chapter.id}.${key} must explain something`);
  }
  assert.ok(chapter.pain?.title && chapter.pain?.body && chapter.pain?.signal);
  assert.ok(chapter.change?.title && chapter.change?.file && chapter.change?.code && chapter.change?.takeaway);
  assert.ok(chapter.run?.title && Array.isArray(chapter.run?.lines) && chapter.run.lines.length >= 2);
  assert.ok(chapter.quiz?.question && Array.isArray(chapter.quiz.options));
  assert.ok(chapter.quiz.options.length >= 2);
  assert.equal(chapter.quiz.options.filter((option) => option.correct === true).length, 1);
  for (const option of chapter.quiz.options) {
    assert.ok(option.text && option.feedback);
  }
}
assert.equal(Course.CHAPTERS[6].nextStage, 'skill');
"""
        )

    def test_course_teaches_evolution_reasons_not_feature_parade(self) -> None:
        self.run_course_assertions(
            """
const byId = Object.fromEntries(Course.CHAPTERS.map((chapter) => [chapter.id, chapter]));
assert.match(byId['model-only'].pain.body, /不能.*(读取|执行|行动)/);
assert.match(byId['first-tool'].change.code, /tool_use|tool_use_id|Tool/);
assert.match(byId['tool-loop'].change.code, /tool_result/);
assert.match(byId['tool-registry'].pain.body, /if|elif|分支|工具/);
assert.equal(Course.TOOL_VS_SKILL.tool.label, 'Tool');
assert.equal(Course.TOOL_VS_SKILL.skill.label, 'Skill');
assert.match(Course.TOOL_VS_SKILL.tool.definition, /能力|动作/);
assert.match(Course.TOOL_VS_SKILL.skill.definition, /流程|方法/);
const skill = Course.ROADMAP.find((item) => item.id === 'skill');
assert.ok(skill);
assert.equal(skill.phase, 'later');
assert.match(skill.trigger, /重复|流程/);
assert.ok(Course.ROADMAP.every((item) => item.id !== 'skill' || item.after.includes('eval')));
"""
        )

    def test_safety_and_evaluation_boundaries_are_explicit(self) -> None:
        self.run_course_assertions(
            """
const byId = Object.fromEntries(Course.CHAPTERS.map((chapter) => [chapter.id, chapter]));
const safety = JSON.stringify(byId['safety-boundary']);
assert.match(safety, /黑名单/);
assert.match(safety, /不是安全边界/);
assert.match(safety, /审批/);
assert.match(safety, /Sandbox/);
assert.match(safety, /workspace/i);
assert.match(safety, /shell=False/);
const trace = JSON.stringify(byId['trace']);
assert.match(trace, /可观察|记录/);
const evaluation = JSON.stringify(byId['eval']);
assert.match(evaluation, /最终验收/);
assert.match(evaluation, /SKIP != PASS/);
assert.doesNotMatch(JSON.stringify(Course), /rm -rf|sudo rm|ANTHROPIC_API_KEY|child_process/);
"""
        )

    def test_page_contract_keeps_course_available_and_preserves_real_trace_views(self) -> None:
        self.assertTrue(EVOLUTION.exists(), "evolution.js is missing")
        self.assertTrue(APP.exists())
        self.assertTrue(INDEX.exists())
        html = INDEX.read_text(encoding="utf-8")
        app = APP.read_text(encoding="utf-8")
        for token in [
            'id="tab-build"',
            'id="view-build"',
            'id="build-chapter-list"',
            'id="build-content"',
            'id="build-prev"',
            'id="build-next"',
            'id="tab-learn"',
            'id="view-learn"',
            'evolution.js',
        ]:
            self.assertIn(token, html)
        for token in [
            'function renderBuild',
            'function setBuildStep',
            'function renderBuildQuiz',
            'buildStep',
            'build-content',
        ]:
            self.assertIn(token, app)
        self.assertIn("switchView(\"build\")", app)


if __name__ == "__main__":
    unittest.main()
