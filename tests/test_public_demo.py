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
        self.assertIn('["brief", "build", "lego"].includes(tab.dataset.view)', app)
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

    def test_public_mode_defaults_to_brief_with_three_entry_points(self) -> None:
        app = APP.read_text(encoding="utf-8")

        self.assertIn("if (publicDemoRequested()) configurePublicDemo();", app)
        self.assertIn('switchView(state.publicDemo ? "brief" : "build");', app)
        self.assertIn('state.view = "brief";', app)
        self.assertIn(
            'if (state.publicDemo && !["brief", "build", "lego"].includes(view)) view = "brief";',
            app,
        )
        self.assertIn('if (briefNumber) briefNumber.textContent = "00";', app)
        self.assertIn('if (buildNumber) buildNumber.textContent = "01";', app)
        self.assertIn('if (legoNumber) legoNumber.textContent = "02";', app)

    def test_brief_is_public_only_and_local_mode_keeps_seven_views(self) -> None:
        html = INDEX.read_text(encoding="utf-8")
        app = APP.read_text(encoding="utf-8")

        self.assertIn('id="tab-brief"', html)
        self.assertIn('data-public-only="true"', html)
        self.assertIn(': tab.dataset.view !== "brief";', app)
        self.assertIn('if (!state.publicDemo && view === "brief") view = "build";', app)
        for view_id in ("build", "learn", "story", "replay", "anatomy", "compare", "lego"):
            self.assertIn(f'id="tab-{view_id}"', html)

    def test_brief_actions_start_baseline_and_open_build_course(self) -> None:
        app = APP.read_text(encoding="utf-8")

        self.assertIn('$("brief-start-lego").addEventListener("click", () => {', app)
        self.assertIn('switchView("lego");\n    startLegoBaseline();', app)
        self.assertIn(
            '$("brief-start-build").addEventListener("click", () => switchView("build"));',
            app,
        )
        self.assertIn('if (view === "brief") return;', app)

    def test_brief_has_90_second_story_and_layered_evidence(self) -> None:
        html = INDEX.read_text(encoding="utf-8")

        self.assertIn('id="view-brief"', html)
        self.assertIn("THE 90-SECOND STORY", html)
        self.assertIn("先撞墙，再补一块，最后看三本账", html)
        self.assertIn("项目证据卡", html)
        for layer in ("工程正确性", "教学有效性", "Agent 效果", "生产安全"):
            self.assertIn(layer, html)
        self.assertIn("不能证明真实模型效果", html)
        self.assertIn("教学效果与真实任务成功率仍待验证", html)

    def test_brief_exposes_no_trace_or_execution_channel(self) -> None:
        html = INDEX.read_text(encoding="utf-8")
        start = html.index('id="view-brief"')
        end = html.index('id="view-build"')
        brief = html[start:end]

        self.assertIn("公开教学模拟 · 不调用模型 API · 不执行真实工具", brief)
        self.assertNotIn("data.json", brief)
        self.assertNotIn("fetch(", brief)
        self.assertNotIn("<script", brief)
        self.assertNotIn("<iframe", brief)


if __name__ == "__main__":
    unittest.main()
