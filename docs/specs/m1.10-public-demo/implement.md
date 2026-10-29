# M1.10 Public Learning Demo Implementation Record

- Spec：`spec.md`
- Plan：`plan.md`
- Tasks：`tasks.md`
- 状态：In Progress
- 实施日期：2026-10-29
- 验证日期：2026-10-29

## 1. 实际交付

Dashboard 新增了明确的公开学习模式：

- Render 域名或 `?demo=public` 在数据加载前进入 `public` 状态；
- 公开模式只保留“从零建造”和“乐高实验”；
- 运行选择器隐藏，页头标识改为“公开学习实验台”；
- 课程状态卡声明公开版只开放两个确定性实验；
- 最后一章不再把访客引导到不可用的真实 Trace，而是保留乐高实验入口；
- 本地存在 `data.json` 时继续显示完整七视图。

公开版没有生成替代 Trace，也没有把教学模拟包装成真实运行。

## 2. 变更文件

| 文件 | 变更 |
|---|---|
| `dashboard/app.js` | 公开模式识别、请求短路、导航裁剪、页头标识、课程状态与 CTA |
| `dashboard/index.html` | 页头标识增加可更新文本节点 |
| `dashboard/styles.css` | 增加 `is-public` 状态点样式 |
| `render.yaml` | 新增静态站点配置，发布路径为 `dashboard` |
| `tests/test_public_demo.py` | 增加公开模式与部署配置契约测试 |
| `README.md` | 增加公开 Demo、部署流程与数据边界 |
| `docs/ROADMAP.md` | 记录 M1.10 |
| `docs/specs/README.md` | 增加规格索引 |
| `main.py` | 版本更新为 v0.12.0 |

## 3. 验收证据

| AC | 证据 | 结果 |
|---|---|---|
| AC-001 | Playwright：公开模式 `data.json` 请求数为 0，导航仅 Build/Lego | Pass |
| AC-002 | Playwright：页头显示公开标识，运行选择器不可见 | Pass |
| AC-003 | DOM 契约 + Playwright：课程状态与最终 CTA 不声称真实 Trace 可用 | Pass |
| AC-004 | Playwright：本地完整模式七视图可见，Build/Lego 可操作 | Pass |
| AC-005 | `test_render_config_publishes_only_dashboard` | Pass |
| AC-006 | 全量 unittest、`node --check`、`compileall` | Pass |
| AC-007 | Render 线上 URL + Playwright 基线交互 | Pending |

## 4. 验证命令

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q agent providers tools scripts tests
node --check dashboard/app.js
node --check dashboard/evolution.js
node --check dashboard/lego.js
node --check dashboard/story.js
```

浏览器验证使用系统 Chrome 与 Playwright，分别覆盖：

- 本地完整模式：`http://127.0.0.1:8766/dashboard/`
- 公开模式：`http://127.0.0.1:8766/dashboard/?demo=public`
- Render 线上页面：待部署与回填。

## 5. 计划与实际偏差

公开模式在 Render 域名之外保留 `?demo=public`，用于本地预览和未来自定义域名。没有新增独立 HTML 页面，避免双份 DOM 和样式漂移。

## 6. 已知限制

- 自定义域名默认不会自动进入公开模式，需要使用 `?demo=public`。
- 本地无 `data.json` 时仍保留真实视图入口，以显示导出说明；这是作者调试路径，不是公开部署路径。
- 公开模式只展示固定教学模拟，不提供真实 Trace、模型 API 或工具执行。

## 7. 失败与负面结果

没有使用合成 Trace 填充五个深挖视图，因为那会把教学数据误表示为真实运行证据。隐藏入口比伪造内容更诚实。

## 8. 后续工作

- 若未来需要公开真实 Trace，必须单独设计脱敏白名单、人工审阅和撤销发布流程。
- 若公开体验需要真实 Agent 运行，应进入 M2/M4，并单独设计后端执行隔离、配额与费用控制。

## 9. 完成声明

- [x] 实现与规格一致（本地）
- [ ] 验收标准有证据（AC-007 待线上验证）
- [x] 测试和静态检查完成（95 项通过）
- [x] 安全边界描述准确
- [ ] 文档已同步（部署结果待回填）
