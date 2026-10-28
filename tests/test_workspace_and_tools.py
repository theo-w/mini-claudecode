from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tools.builtin import build_registry


class WorkspaceAndToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.registry = build_registry(
            self.workspace,
            max_observation_chars=1000,
            shell_timeout_seconds=3,
            python_timeout_seconds=3,
        )

    def test_path_traversal_and_sibling_prefix_are_rejected(self) -> None:
        sibling = self.root / "workspace-evil"
        sibling.mkdir()
        (sibling / "secret.txt").write_text("secret", encoding="utf-8")

        result = self.registry.invoke(
            "read_file", {"file_path": "../workspace-evil/secret.txt"}
        )
        self.assertFalse(result.ok)
        self.assertIn("路径越权", result.content)

        absolute = self.registry.invoke(
            "read_file", {"file_path": str(sibling / "secret.txt")}
        )
        self.assertFalse(absolute.ok)
        self.assertIn("路径越权", absolute.content)

    def test_symlink_escape_is_rejected(self) -> None:
        outside = self.root / "outside.txt"
        outside.write_text("outside", encoding="utf-8")
        (self.workspace / "link.txt").symlink_to(outside)

        result = self.registry.invoke("read_file", {"file_path": "link.txt"})
        self.assertFalse(result.ok)
        self.assertIn("路径越权", result.content)

    def test_read_grep_find_and_write(self) -> None:
        (self.workspace / "src").mkdir()
        (self.workspace / "src" / "app.py").write_text(
            "first\n# TODO: learn agents\nlast\n", encoding="utf-8"
        )

        read_result = self.registry.invoke(
            "read_file",
            {"file_path": "src/app.py", "start_line": 2, "end_line": 2},
        )
        self.assertTrue(read_result.ok)
        self.assertIn("TODO", read_result.content)
        self.assertNotIn("first", read_result.content)
        self.assertIn("ends_with_newline: true", read_result.content)

        grep_result = self.registry.invoke(
            "grep", {"file_path": "src/app.py", "pattern": "TODO"}
        )
        self.assertTrue(grep_result.ok)
        self.assertIn("2:", grep_result.content)

        find_result = self.registry.invoke(
            "find", {"root": ".", "name_pattern": "app"}
        )
        self.assertTrue(find_result.ok)
        self.assertIn("src/app.py", find_result.content)

        write_result = self.registry.invoke(
            "write_file", {"file_path": "notes/new.md", "content": "hello"}
        )
        self.assertTrue(write_result.ok)
        self.assertEqual(
            (self.workspace / "notes" / "new.md").read_text(encoding="utf-8"),
            "hello",
        )

    def test_shell_is_argv_only_and_has_no_blacklist_false_positive(self) -> None:
        result = self.registry.invoke("run_shell", {"cmd": "echo format"})
        self.assertTrue(result.ok)
        self.assertIn("exit_code: 0", result.content)
        self.assertIn("format", result.content)

    def test_python_runs_in_child_process_and_captures_stdout(self) -> None:
        result = self.registry.invoke(
            "run_python", {"code": "print(19 * 23)"}
        )
        self.assertTrue(result.ok)
        self.assertIn("437", result.content)

    def test_observation_is_truncated(self) -> None:
        registry = build_registry(self.workspace, max_observation_chars=10)
        result = registry.invoke(
            "write_file", {"file_path": "large.txt", "content": "x" * 100}
        )
        self.assertTrue(result.ok)
        read_result = registry.invoke("read_file", {"file_path": "large.txt"})
        self.assertTrue(read_result.ok)
        self.assertLessEqual(len(read_result.content), 10 + len("\n... [内容截断]"))
        self.assertIn("内容截断", read_result.content)


if __name__ == "__main__":
    unittest.main()
