from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "dashboard" / "app.js"
INDEX = ROOT / "dashboard" / "index.html"
RENDER = ROOT / "render.yaml"
GITIGNORE = ROOT / ".gitignore"


class PublicLearningDemoTests(unittest.TestCase):
    def test_public_mode_short_circuits_before_loading_trace_data(self) -> None:
        app = APP.read_text(encoding="utf-8")

        public_guard = app.index("if (publicDemoRequested())")
        data_fetch = app.index('const response = await fetch("data.json"')
        self.assertLess(public_guard, data_fetch)
        self.assertIn('params.get("demo") === "public"', app)
        self.assertIn('endsWith(".onrender.com")', app)
        self.assertIn('state.dataState = publicDemo ? "public" : "missing"', app)
        self.assertIn('["build", "lego"].includes(tab.dataset.view)', app)
        self.assertIn("公开学习实验台", app)
        self.assertIn("公开版不读取或展示真实 Trace", app)
        self.assertIn('const finishLabel = state.publicDemo ? "进入乐高实验 →" : "进入真实解剖 →";', app)
        self.assertIn('switchView(state.publicDemo ? "lego" : "learn");', app)

    def test_render_config_publishes_only_dashboard_static_files(self) -> None:
        config = RENDER.read_text(encoding="utf-8")
        ignored = GITIGNORE.read_text(encoding="utf-8")

        self.assertIn("type: web", config)
        self.assertIn("name: mini-agent-harness", config)
        self.assertIn("runtime: static", config)
        self.assertIn("staticPublishPath: dashboard", config)
        self.assertNotIn("API_KEY", config)
        self.assertNotIn("ANTHROPIC", config)
        self.assertNotIn("OPENAI", config)
        self.assertIn("dashboard/data.json", ignored)

    def test_public_demo_has_explicit_boundary_copy(self) -> None:
        html = INDEX.read_text(encoding="utf-8")
        app = APP.read_text(encoding="utf-8")

        self.assertIn('class="badge-label"', html)
        self.assertIn("确定性机制模拟 · 不调用 API · 不执行工具", html)
        self.assertIn("公开版只开放两个确定性实验", app)
        self.assertIn("课程与装配实验不依赖真实 Trace", app)


if __name__ == "__main__":
    unittest.main()
