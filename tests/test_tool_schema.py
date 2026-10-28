from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tools.builtin import build_registry


class ToolSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.registry = build_registry(Path(self.temp_dir.name))

    def test_all_tools_have_valid_openai_envelope(self) -> None:
        schemas = self.registry.openai_schemas()
        self.assertEqual(len(schemas), 7)
        for schema in schemas:
            self.assertEqual(schema["type"], "function")
            self.assertIn("function", schema)
            function = schema["function"]
            self.assertEqual(set(function), {"name", "description", "parameters"})
            self.assertTrue(function["name"])
            self.assertTrue(function["description"])
            self.assertEqual(function["parameters"]["type"], "object")
            self.assertIn("properties", function["parameters"])
            self.assertIn("required", function["parameters"])

    def test_ls_default_argument_is_optional(self) -> None:
        ls_schema = next(
            schema for schema in self.registry.openai_schemas()
            if schema["function"]["name"] == "ls"
        )
        self.assertEqual(ls_schema["function"]["parameters"]["required"], [])

    def test_schema_names_match_registry(self) -> None:
        schema_names = {
            schema["function"]["name"] for schema in self.registry.openai_schemas()
        }
        registry_names = {spec.name for spec in self.registry.specs}
        self.assertEqual(schema_names, registry_names)
        self.assertEqual(
            schema_names,
            {
                "ls",
                "read_file",
                "write_file",
                "grep",
                "find",
                "run_shell",
                "run_python",
            },
        )


if __name__ == "__main__":
    unittest.main()
