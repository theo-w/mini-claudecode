from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from agent.anatomy import build_catalog
from scripts.export_dashboard import (
    build_dashboard_data,
    link_tool_events,
    load_report,
    load_task_contracts,
    merge_task_contracts,
    summarize_fixture,
)
from tools.builtin import build_registry


class AgentAnatomyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.registry = build_registry(self.workspace)

    def test_catalog_uses_real_registry(self) -> None:
        catalog = build_catalog(self.registry)
        tools = {tool["name"]: tool for tool in catalog["tools"]}

        self.assertEqual(
            set(tools),
            {"ls", "read_file", "write_file", "grep", "find", "run_shell", "run_python"},
        )
        self.assertEqual(
            tools["read_file"]["parameters"]["required"],
            self.registry.get_spec("read_file").parameters["required"],
        )
        self.assertEqual(tools["read_file"]["source"]["path"], "tools/builtin.py")
        self.assertGreater(tools["read_file"]["source"]["line"], 0)
        self.assertFalse(tools["read_file"]["requires_approval"])
        self.assertTrue(tools["write_file"]["requires_approval"])
        self.assertEqual(tools["run_python"]["risk"], "execute")

    def test_catalog_contains_learning_modules_and_connections(self) -> None:
        catalog = build_catalog(self.registry)
        modules = {module["id"]: module for module in catalog["modules"]}

        self.assertTrue(
            {"model", "loop", "tools", "approval", "context", "compaction", "trace", "eval"}
            <= set(modules)
        )
        self.assertIn("tools", modules["loop"]["connects_to"])
        self.assertIn("loop", modules["model"]["connects_to"])
        for module in modules.values():
            self.assertTrue(module["source"]["path"])

    def test_legacy_events_gain_inferred_call_ids(self) -> None:
        events = [
            {
                "event": "model_response",
                "step": 1,
                "tool_calls": [
                    {"id": "call-1", "name": "ls", "arguments": '{"dir_path":"."}'},
                    {"id": "call-2", "name": "ls", "arguments": '{"dir_path":"docs"}'},
                ],
            },
            {"event": "tool_call", "step": 1, "tool": "ls", "arguments": {"dir_path": "."}},
            {
                "event": "tool_result",
                "step": 1,
                "tool": "ls",
                "content": "README.md",
                "ok": True,
            },
            {
                "event": "tool_call",
                "step": 1,
                "tool": "ls",
                "arguments": {"dir_path": "docs"},
            },
            {
                "event": "tool_result",
                "step": 1,
                "tool": "ls",
                "content": "specs",
                "ok": True,
            },
        ]

        linked = link_tool_events(events)

        self.assertEqual(linked[1]["call_id"], "call-1")
        self.assertEqual(linked[1]["call_id_source"], "inferred")
        self.assertEqual(linked[2]["call_id"], "call-1")
        self.assertEqual(linked[3]["call_id"], "call-2")
        self.assertEqual(linked[4]["call_id"], "call-2")

    def test_recorded_call_id_is_not_overwritten(self) -> None:
        events = [
            {
                "event": "tool_call",
                "step": 2,
                "tool": "ls",
                "call_id": "recorded-id",
                "arguments": {},
            }
        ]

        linked = link_tool_events(events)

        self.assertEqual(linked[0]["call_id"], "recorded-id")
        self.assertEqual(linked[0]["call_id_source"], "recorded")

    def test_load_report_allowlists_summary_and_clips_content(self) -> None:
        report_path = self.root / "private-report.json"
        report_path.write_text(
            json.dumps(
                {
                    "timestamp": "2026-10-28T00:00:00",
                    "provider": "local",
                    "model": "test-model",
                    "passed": 1,
                    "total": 1,
                    "success_rate": 1.0,
                    "api_key": "must-not-export",
                    "source_absolute_path": str(report_path),
                    "records": [
                        {
                            "id": "task-1",
                            "group": "test",
                            "passed": True,
                            "status": "completed",
                            "steps": 1,
                            "checks": [],
                            "context": {"turns": []},
                            "final_text": "x" * 30,
                            "events": [],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        run = load_report(report_path, "baseline", max_content_chars=10)
        encoded = json.dumps(run, ensure_ascii=False)

        self.assertEqual(run["source_name"], "private-report.json")
        self.assertNotIn(str(report_path), encoded)
        self.assertNotIn("must-not-export", encoded)
        self.assertNotIn("api_key", run)
        self.assertIn("truncated", run["records"][0]["final_text"])
        self.assertLess(len(run["records"][0]["final_text"]), 40)

    def test_summarize_fixture_calculates_repeated_line_count(self) -> None:
        summary = summarize_fixture(
            {
                "repeat_lines": ["a", "b", "c", "d"],
                "repeat": 24,
                "tail_lines": ["ACCESS_CODE: secret", "done", "tail"],
            }
        )

        self.assertEqual(summary["kind"], "repeated")
        self.assertEqual(summary["line_count"], 99)
        self.assertEqual(summary["repeat_lines"], 4)
        self.assertEqual(summary["repeat"], 24)
        self.assertEqual(summary["tail_lines"], 3)
        self.assertNotIn("ACCESS_CODE", json.dumps(summary, ensure_ascii=False))

    def test_load_task_contracts_summarizes_fixtures_without_content(self) -> None:
        task_path = self.root / "tasks.json"
        task_path.write_text(
            json.dumps(
                [
                    {
                        "id": "task-1",
                        "group": "retention",
                        "tags": ["exact_value", "pagination"],
                        "prompt": "read the fixture",
                        "setup": {
                            "audit.log": {
                                "repeat_lines": ["a", "b", "c", "d"],
                                "repeat": 24,
                                "tail_lines": ["ACCESS_CODE: must-not-export", "done", "tail"],
                            },
                            "notes.txt": "private fixture body\nsecond line",
                        },
                        "checks": [{"type": "tool_succeeded", "name": "read_file"}],
                        "max_steps": 10,
                    }
                ]
            ),
            encoding="utf-8",
        )

        contracts = load_task_contracts([task_path])
        contract = contracts["task-1"]
        encoded = json.dumps(contracts, ensure_ascii=False)

        self.assertEqual(contract["prompt"], "read the fixture")
        self.assertEqual(contract["fixtures"][0]["line_count"], 99)
        self.assertEqual(contract["fixtures"][1]["line_count"], 2)
        self.assertNotIn("private fixture body", encoded)
        self.assertNotIn("must-not-export", encoded)
        self.assertNotIn("setup", encoded)

    def test_merge_task_contracts_accepts_equal_and_rejects_conflicting_duplicates(self) -> None:
        first = {"id": "task-1", "prompt": "same", "checks": [], "fixtures": []}
        duplicate = {"id": "task-1", "prompt": "same", "checks": [], "fixtures": []}
        conflict = {"id": "task-1", "prompt": "different", "checks": [], "fixtures": []}

        merged = merge_task_contracts([first, duplicate])
        self.assertEqual(merged["task-1"]["prompt"], "same")
        with self.assertRaisesRegex(ValueError, "冲突"):
            merge_task_contracts([first, conflict])

    def test_dashboard_data_contains_runs_without_fabricating_revision(self) -> None:
        report_path = self.root / "run.json"
        report_path.write_text(
            json.dumps(
                {
                    "provider": "local",
                    "model": "test-model",
                    "records": [],
                }
            ),
            encoding="utf-8",
        )
        run = load_report(report_path, "run-a")

        data = build_dashboard_data(
            [run],
            self.registry,
            generated_at="2026-10-28T00:00:00+00:00",
        )

        self.assertEqual(data["schema_version"], 1)
        self.assertEqual(data["generated_at"], "2026-10-28T00:00:00+00:00")
        self.assertEqual(data["runs"][0]["label"], "run-a")
        self.assertIsNone(data["runs"][0]["code_revision"])
        self.assertEqual(data["data_classification"], "local-unredacted")
        self.assertEqual(len(data["catalog"]["tools"]), 7)


    def test_cli_exports_from_repository_root(self) -> None:
        report_path = self.root / "run.json"
        output_path = self.root / "dashboard" / "data.json"
        report_path.write_text(
            json.dumps({"provider": "local", "model": "test", "records": []}),
            encoding="utf-8",
        )

        completed = subprocess.run(
            [
                sys.executable,
                "scripts/export_dashboard.py",
                str(report_path),
                "--labels",
                "cli",
                "--output",
                str(output_path),
            ],
            cwd=Path(__file__).resolve().parent.parent,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertTrue(output_path.exists())
        self.assertIn("local-unredacted", completed.stdout)

    def test_cli_accepts_repeated_task_files(self) -> None:
        report_path = self.root / "run.json"
        task_path = self.root / "tasks.json"
        output_path = self.root / "dashboard" / "data.json"
        report_path.write_text(
            json.dumps({"provider": "local", "model": "test", "records": []}),
            encoding="utf-8",
        )
        task_path.write_text(
            json.dumps(
                [
                    {
                        "id": "task-1",
                        "group": "test",
                        "prompt": "do the task",
                        "setup": {"notes.txt": "one\ntwo"},
                        "checks": [],
                    }
                ]
            ),
            encoding="utf-8",
        )

        completed = subprocess.run(
            [
                sys.executable,
                "scripts/export_dashboard.py",
                str(report_path),
                "--labels",
                "cli",
                "--tasks",
                str(task_path),
                "--output",
                str(output_path),
            ],
            cwd=Path(__file__).resolve().parent.parent,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        data = json.loads(output_path.read_text(encoding="utf-8"))
        self.assertEqual(data["task_contracts"]["task-1"]["fixtures"][0]["line_count"], 2)
        self.assertNotIn("one\ntwo", output_path.read_text(encoding="utf-8"))

    def test_report_without_records_is_rejected(self) -> None:
        report_path = self.root / "broken.json"
        report_path.write_text('{"model":"test"}', encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "records"):
            load_report(report_path, "broken")


if __name__ == "__main__":
    unittest.main()
