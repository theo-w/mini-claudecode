from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
STORY = ROOT / "dashboard" / "story.js"


class DashboardStoryTests(unittest.TestCase):
    def run_story_assertions(self, assertions: str, *payloads: object) -> None:
        script = f"""
const assert = require('node:assert/strict');
const Story = require({json.dumps(str(STORY))});
const payloads = {json.dumps(payloads, ensure_ascii=False)};
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

    def test_groups_model_rounds_and_links_tool_result_by_call_id(self) -> None:
        record = {
            "events": [
                {"event": "run_started", "sequence": 0},
                {
                    "event": "model_request",
                    "step": 1,
                    "context_chars": 513,
                    "message_count": 2,
                    "sequence": 1,
                },
                {
                    "event": "model_response",
                    "step": 1,
                    "content": "",
                    "tool_calls": [{"id": "call-1", "name": "read_file", "arguments": "{\"file_path\":\"notes.txt\"}"}],
                    "sequence": 2,
                },
                {
                    "event": "tool_call",
                    "step": 1,
                    "tool": "read_file",
                    "call_id": "call-1",
                    "arguments": {"file_path": "notes.txt"},
                    "sequence": 3,
                },
                {
                    "event": "tool_result",
                    "step": 1,
                    "tool": "read_file",
                    "call_id": "call-1",
                    "ok": True,
                    "content": "total_lines: 99\nrequested_range: 1-99\nreturned_range: 1-21\nhas_more: true\nnext_start_line: 22\n---\nfirst line",
                    "sequence": 4,
                },
                {"event": "history_compaction", "step": 2, "compacted": False, "reason": "no_older_history", "sequence": 5},
                {"event": "model_request", "step": 2, "context_chars": 700, "message_count": 4, "sequence": 6},
                {
                    "event": "model_response",
                    "step": 2,
                    "content": "DONE",
                    "tool_calls": [],
                    "sequence": 7,
                },
                {"event": "run_finished", "status": "completed", "steps": 2, "sequence": 8},
            ]
        }

        self.run_story_assertions(
            """
const story = Story.groupRounds(payloads[0]);
assert.equal(story.rounds.length, 2);
assert.equal(story.runEvents.length, 2);
assert.equal(story.rounds[0].calls.length, 1);
assert.equal(story.rounds[0].calls[0].call.call_id, 'call-1');
assert.equal(story.rounds[0].calls[0].result.call_id, 'call-1');
assert.equal(story.rounds[0].branch.type, 'tool');
assert.equal(story.rounds[1].branch.type, 'finish');
const path = Story.toolPath(payloads[0]);
assert.deepEqual(path.usedTools, ['read_file']);
assert.equal(path.totalCalls, 1);
""",
            record,
        )

    def test_builds_plain_observation_and_event_driven_loop_branches(self) -> None:
        record = {
            "events": [
                {
                    "event": "model_response",
                    "step": 1,
                    "tool_calls": [{"id": "call-1", "name": "read_file"}],
                },
                {
                    "event": "tool_result",
                    "step": 1,
                    "tool": "read_file",
                    "call_id": "call-1",
                    "ok": True,
                    "content": "total_lines: 99\nrequested_range: 1-99\nreturned_range: 1-21\nhas_more: true\nnext_start_line: 22\n---\nfirst line",
                },
                {"event": "model_response", "step": 2, "content": "ACCESS_CODE: M12", "tool_calls": []},
            ]
        }
        event = record["events"][1]

        self.run_story_assertions(
            """
const summary = Story.observationSummary(payloads[0]);
assert.match(summary, /1–21/);
assert.match(summary, /第 22 行/);
const journey = Story.loopJourney(payloads[1]);
assert.deepEqual(journey.map((item) => item.branch), ['tool', 'finish']);
assert.deepEqual(journey[0].tools, ['read_file']);
assert.deepEqual(journey[1].tools, []);
assert.equal(Story.loopNodeForEvent(payloads[1].events[1]), 'observation');
assert.equal(Story.loopNodeForEvent(payloads[1].events[0]), 'decision');
""",
            event,
            record,
        )

    def test_finds_first_result_and_check_divergence(self) -> None:
        run_a = {
            "label": "off",
            "records": [
                {
                    "id": "task-1",
                    "passed": True,
                    "checks": [
                        {"check": "tool_succeeded:read_file", "passed": True},
                        {"check": "tool_call_count:2:actual=5", "passed": True},
                    ],
                },
                {"id": "task-2", "passed": True, "checks": []},
            ],
        }
        run_b = {
            "label": "extractive",
            "records": [
                {
                    "id": "task-1",
                    "passed": False,
                    "checks": [
                        {"check": "tool_succeeded:read_file", "passed": True},
                        {"check": "tool_call_count:2:actual=1", "passed": False},
                    ],
                },
                {"id": "task-2", "passed": True, "checks": []},
            ],
        }
        same_run = {**run_b, "records": [{**run_a["records"][0]}, {"id": "task-2", "passed": True, "checks": []}]}

        self.run_story_assertions(
            """
const diff = Story.findFirstDivergence(payloads[0], payloads[1]);
assert.equal(diff.type, 'result');
assert.equal(diff.taskId, 'task-1');
assert.equal(diff.a.passed, true);
assert.equal(diff.b.passed, false);
assert.equal(diff.check.a.check, 'tool_call_count:2:actual=5');
assert.equal(diff.check.b.passed, false);
const none = Story.findFirstDivergence(payloads[2], payloads[2]);
assert.equal(none.type, 'none');
""",
            run_a,
            run_b,
            same_run,
        )

    def test_dashboard_defaults_to_story_and_folds_raw_evidence(self) -> None:
        html = (ROOT / "dashboard" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "dashboard" / "app.js").read_text(encoding="utf-8")

        self.assertIn('data-view="story"', html)
        self.assertIn('class="view-tab active"', html)
        self.assertIn("story.js", html)
        self.assertIn("原始事件 JSON", app)
        self.assertIn('h("details"', app)
        self.assertNotIn("cdn.", html.lower())


if __name__ == "__main__":
    unittest.main()
