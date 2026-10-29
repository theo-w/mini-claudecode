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

    def test_observation_summary_distinguishes_request_and_file_remainder(self) -> None:
        self.run_story_assertions(
            """
const pageDoneButFileContinues = Story.observationSummary({
  event: 'tool_result',
  ok: true,
  content: [
    'total_lines: 85',
    'requested_range: 23-44',
    'returned_range: 23-44',
    'has_more: false',
    'next_start_line: 45',
    'file_has_more: true',
    'budget_limited: false',
    '---',
    'page',
  ].join('\\n'),
});
assert.match(pageDoneButFileContinues, /文件仍有后续/);
assert.match(pageDoneButFileContinues, /第 45 行/);
assert.doesNotMatch(pageDoneButFileContinues, /已到文件末尾/);

const fileDone = Story.observationSummary({
  event: 'tool_result',
  ok: true,
  content: [
    'total_lines: 44',
    'requested_range: 23-44',
    'returned_range: 23-44',
    'has_more: false',
    'file_has_more: false',
    'budget_limited: false',
    '---',
    'page',
  ].join('\\n'),
});
assert.match(fileDone, /已到文件末尾/);
"""
        )

    def test_reports_continuation_gap_only_when_next_turn_stops(self) -> None:
        events = [
            {"event": "model_request", "step": 1, "context_chars": 500, "message_count": 2},
            {
                "event": "model_response",
                "step": 1,
                "content": "",
                "tool_calls": [{"id": "call-1", "name": "read_file", "arguments": {"file_path": "audit.log"}}],
            },
            {"event": "tool_call", "step": 1, "tool": "read_file", "call_id": "call-1", "arguments": {"file_path": "audit.log"}},
            {
                "event": "tool_result",
                "step": 1,
                "tool": "read_file",
                "call_id": "call-1",
                "ok": True,
                "content": (
                    "total_lines: 85\nrequested_range: 1-85\nreturned_range: 23-44\n"
                    "has_more: false\nnext_start_line: 45\nfile_has_more: true\n---\npage"
                ),
            },
            {"event": "model_request", "step": 2, "context_chars": 900, "message_count": 4},
        ]
        stopped = {
            "id": "task-1",
            "events": events + [{"event": "model_response", "step": 2, "content": "No more matches", "tool_calls": []}],
        }
        continued = {
            "id": "task-2",
            "events": events + [
                {
                    "event": "model_response",
                    "step": 2,
                    "content": "",
                    "tool_calls": [{"id": "call-2", "name": "read_file", "arguments": {"file_path": "audit.log", "start_line": 45}}],
                },
                {"event": "tool_call", "step": 2, "tool": "read_file", "call_id": "call-2", "arguments": {"file_path": "audit.log", "start_line": 45}},
                {
                    "event": "tool_result",
                    "step": 2,
                    "tool": "read_file",
                    "call_id": "call-2",
                    "ok": True,
                    "content": (
                        "total_lines: 85\nrequested_range: 45-85\nreturned_range: 45-85\n"
                        "has_more: false\nfile_has_more: false\n---\npage"
                    ),
                },
            ],
        }

        self.run_story_assertions(
            """
const gap = Story.continuationGap(payloads[0]);
assert.ok(gap);
assert.equal(gap.fromStep, 1);
assert.equal(gap.nextStep, 2);
assert.equal(gap.returnedRange, '23-44');
assert.equal(gap.nextStartLine, 45);
assert.equal(gap.totalLines, 85);
assert.equal(gap.nextBranch, 'finish');
assert.equal(Story.continuationGap(payloads[1]), null);
""",
            stopped,
            continued,
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

    def test_explains_fixture_and_classifies_skipped_checks(self) -> None:
        contract = {
            "id": "task-1",
            "prompt": "read all pages",
            "fixtures": [
                {
                    "path": "audit.log",
                    "kind": "repeated",
                    "line_count": 99,
                    "head_lines": 0,
                    "repeat_lines": 4,
                    "repeat": 24,
                    "tail_lines": 3,
                }
            ],
        }

        self.run_story_assertions(
            """
const fixture = Story.fixtureSummary(payloads[0]);
assert.equal(fixture.hasContract, true);
assert.equal(fixture.totalLineCount, 99);
assert.match(fixture.composition, /24 × 4 \+ 3 = 99/);
const skipped = Story.classifyCheck(payloads[1][0]);
assert.equal(skipped.status, 'SKIP');
assert.equal(skipped.group, 'integrity');
assert.match(skipped.skipReason, /策略关闭/);
const failed = Story.classifyCheck(payloads[1][1]);
assert.equal(failed.status, 'FAIL');
const unknown = Story.classifyCheck(payloads[1][2]);
assert.equal(unknown.status, 'UNKNOWN');
""",
            contract,
            [
                {"check": "compaction_count_at_least:1:actual=0:skipped=off", "passed": True},
                {"check": "output_contains:'ACCESS_CODE'", "passed": False},
                {"check": "new_check", "passed": None},
            ],
        )

    def test_groups_checks_by_learning_purpose(self) -> None:
        checks = [
            {"check": "tool_succeeded:read_file", "passed": True},
            {"check": "tool_call_count_at_least:read_file:2:actual=5", "passed": True},
            {"check": "tool_not_called:grep", "passed": True},
            {"check": "compaction_count_at_least:1:actual=0:skipped=off", "passed": True},
            {"check": "output_contains:'M12-VALUE-7319'", "passed": True},
        ]

        self.run_story_assertions(
            """
const groups = Story.checkGroups(payloads[0]);
assert.deepEqual(groups.slice(0, 4).map((group) => group.id), [
  'acceptance', 'constraint', 'capability', 'integrity'
]);
assert.equal(groups.find((group) => group.id === 'acceptance').checks.length, 1);
assert.equal(groups.find((group) => group.id === 'constraint').checks.length, 1);
assert.equal(groups.find((group) => group.id === 'capability').checks.length, 2);
assert.equal(groups.find((group) => group.id === 'integrity').checks.length, 1);
assert.match(groups.find((group) => group.id === 'constraint').checks[0].prevents, /grep/);
""",
            checks,
        )

    def test_builds_strong_causal_edge_only_from_matching_fields(self) -> None:
        def pagination_record(second_start: int) -> dict:
            events = []
            for step, start, end, next_start in ((1, 1, 21, 22), (2, second_start, second_start + 20, None)):
                call_id = f"call-{step}"
                events.extend(
                    [
                        {"event": "model_request", "step": step, "context_chars": 500 + step, "message_count": step * 2},
                        {
                            "event": "model_response",
                            "step": step,
                            "content": "",
                            "tool_calls": [{"id": call_id, "name": "read_file", "arguments": {"file_path": "audit.log", "start_line": start}}],
                        },
                        {
                            "event": "tool_call",
                            "step": step,
                            "tool": "read_file",
                            "call_id": call_id,
                            "arguments": {"file_path": "audit.log", "start_line": start},
                        },
                        {
                            "event": "tool_result",
                            "step": step,
                            "tool": "read_file",
                            "call_id": call_id,
                            "ok": True,
                            "content": (
                                f"total_lines: 42\nreturned_range: {start}-{end}\n"
                                f"has_more: {'true' if next_start else 'false'}\n"
                                + (f"next_start_line: {next_start}\n" if next_start else "")
                                + "---\npage"
                            ),
                        },
                    ]
                )
            events.append({"event": "model_response", "step": 3, "content": "DONE", "tool_calls": []})
            return {"id": "task-1", "passed": True, "checks": [], "events": events}

        contract = {"id": "task-1", "prompt": "read all pages", "fixtures": []}

        self.run_story_assertions(
            """
const metadata = Story.parseObservationMetadata(payloads[0].events[3]);
assert.equal(metadata.has_more, true);
assert.equal(metadata.next_start_line, 22);
const chain = Story.buildCausalChain(payloads[0], payloads[1]);
assert.equal(chain.stages.filter((stage) => stage.kind === 'turn').length, 2);
assert.equal(chain.strongEdges.length, 1);
assert.equal(chain.strongEdges[0].field, 'next_start_line');
assert.equal(chain.strongEdges[0].observationValue, 22);
assert.equal(chain.strongEdges[0].callValue, 22);
assert.ok(chain.stages.some((stage) => stage.kind === 'stop'));
const mismatch = Story.buildCausalChain(payloads[2], payloads[1]);
assert.equal(mismatch.strongEdges.length, 0);
assert.equal(mismatch.links.find((link) => link.from === 'turn-1' && link.to === 'turn-2').strong, false);
""",
            pagination_record(22),
            contract,
            pagination_record(23),
        )

    def test_collapses_continuous_pagination_into_one_episode(self) -> None:
        events = []
        pages = [(1, 1, 21, 22), (2, 22, 42, 43), (3, 43, 63, 64), (4, 64, 84, 85), (5, 85, 99, None)]
        for step, start, end, next_start in pages:
            call_id = f"call-{step}"
            events.extend(
                [
                    {"event": "model_request", "step": step, "context_chars": 500 + step, "message_count": step * 2},
                    {
                        "event": "model_response",
                        "step": step,
                        "tool_calls": [{"id": call_id, "name": "read_file", "arguments": {"file_path": "audit.log", "start_line": start}}],
                    },
                    {
                        "event": "tool_call",
                        "step": step,
                        "tool": "read_file",
                        "call_id": call_id,
                        "arguments": {"file_path": "audit.log", "start_line": start},
                    },
                    {
                        "event": "tool_result",
                        "step": step,
                        "tool": "read_file",
                        "call_id": call_id,
                        "ok": True,
                        "content": (
                            f"total_lines: 99\nreturned_range: {start}-{end}\n"
                            f"has_more: {'true' if next_start else 'false'}\n"
                            + (f"next_start_line: {next_start}\n" if next_start else "")
                            + "---\npage"
                        ),
                    },
                ]
            )
        events.append({"event": "model_response", "step": 6, "content": "DONE", "tool_calls": []})
        record = {"id": "task-1", "passed": True, "checks": [], "events": events}

        self.run_story_assertions(
            """
const chain = Story.buildCausalChain(payloads[0], payloads[1]);
const episodes = Story.collapseEpisodes(chain);
assert.equal(chain.strongEdges.length, 4);
const continuation = episodes.find((episode) => episode.kind === 'continuation');
assert.ok(continuation);
assert.equal(continuation.stages.length, 5);
assert.equal(continuation.firstStep, 1);
assert.equal(continuation.lastStep, 5);
assert.match(continuation.detail, /1–21/);
assert.match(continuation.detail, /85–99/);
assert.equal(episodes.length, 4);
""",
            record,
            {"id": "task-1", "prompt": "read all pages", "fixtures": [{"path": "audit.log", "kind": "repeated", "line_count": 99}]},
        )

    def test_dashboard_defaults_to_guided_path_and_folds_raw_evidence(self) -> None:
        html = (ROOT / "dashboard" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "dashboard" / "app.js").read_text(encoding="utf-8")

        self.assertEqual(html.count('class="view-tab active"'), 1)
        self.assertIn(
            'id="tab-learn" role="tab" aria-selected="true" '
            'aria-controls="view-learn" data-view="learn"',
            html,
        )
        self.assertIn(
            '<section id="view-learn" class="view-panel" role="tabpanel" '
            'aria-labelledby="tab-learn">',
            html,
        )
        for view in ("story", "replay", "anatomy", "compare"):
            self.assertIn(
                f'<section id="view-{view}" class="view-panel" role="tabpanel" '
                f'aria-labelledby="tab-{view}" hidden>',
                html,
            )

        self.assertEqual(html.count("data-learn-step="), 5)
        self.assertIn('aria-current="step"', html)
        for marker in (
            "learn-assembly-board",
            "loop-summary-board",
            "learn-test-table",
            "learn-takeaway-grid",
            "learn-deep-grid",
        ):
            self.assertIn(marker, app)

        self.assertIn("story.js", html)
        self.assertIn('fetch("data.json"', app)
        self.assertIn('h("details", "loop-trace-drawer"', app)
        self.assertIn('h("details", `learn-test-dossier', app)
        self.assertIn("原始事件 JSON", app)
        self.assertIn("function h(tag, className, ...content)", app)
        self.assertNotRegex(app, r'h\([^,\n]+,\s*h\(')
        self.assertNotIn("cdn.", html.lower())


if __name__ == "__main__":
    unittest.main()
