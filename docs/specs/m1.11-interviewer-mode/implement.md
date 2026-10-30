# M1.11 Interviewer Project Brief Implementation Record

- Spec：`spec.md`
- Plan：`plan.md`
- Tasks：`tasks.md`
- 状态：Verified（本地与 Render 线上验收完成）
- 实施日期：2026-10-30
- 验证日期：2026-10-30

## 1. 实际交付

公开版现在默认进入“项目速览”：

- 首屏说明目标用户、Agent 初学者的理解断点、核心学习假设和公开安全边界；
- 三步故事按“只有模型会卡住 → 每次只加一块 → 完成度/安全/审计分开判断”展开；
- 项目证据卡集中列出目标用户、问题、假设、交付、工程证据与当前局限；
- 四层证据表明确区分工程正确性、教学有效性、Agent 效果和生产安全；
- 主 CTA 直接进入乐高并运行一次空装配基线，次 CTA 进入从零建造；
- 公开导航只保留“项目速览 / 从零建造 / 乐高实验”；
- 本地完整模式隐藏速览，默认仍为“从零建造”，原七视图保持可用。

公开模式仍在 `fetch("data.json")` 之前短路。速览本身不含 Trace、模型 API、工具执行、Shell、iframe 或外部脚本。

## 2. 变更文件

| 文件 | 变更 |
|---|---|
| `dashboard/index.html` | 增加 Brief 标签、项目速览 DOM、三步故事、证据卡、四层证据、面试路线与两个 CTA |
| `dashboard/app.js` | 增加公开 `brief/build/lego` 状态机、默认入口、主/次 CTA、可见标签键盘遍历 |
| `dashboard/styles.css` | 增加 Brief Hero、Block 卡、证据卡、路线与 1120/900/760/520px 响应式样式 |
| `tests/test_public_demo.py` | 新增 5 项公开 Brief 契约测试，更新公开导航断言 |
| `docs/specs/m1.11-interviewer-mode/*` | 新增 Spec/Plan/Tasks/Implement |
| `docs/specs/README.md` | 增加 M1.11 索引 |
| `docs/ROADMAP.md` | 增加 M1.11 交付记录与后续边界 |
| `README.md` | 更新公开体验说明、版本、测试数与规格链接 |
| `main.py` | 版本更新为 `v0.13.0` |

## 3. 验收证据

| AC | 证据 | 结果 |
|---|---|---|
| AC-001 | Playwright：公开模式活动视图 `view-brief`；可见标签恰为 Brief/Build/Lego | Pass |
| AC-002 | Playwright：公开模式 `data.json` 请求数 0 | Pass |
| AC-003 | Playwright：本地模式默认 `view-build`，可见 7 个标签，Brief 隐藏；逐一切换七视图均有内容 | Pass |
| AC-004 | `test_brief_has_90_second_story_and_layered_evidence`；Playwright DOM 内容检查 | Pass |
| AC-005 | `test_brief_actions_start_baseline_and_open_build_course`；Playwright 点击后得到 `BLOCKED / UNKNOWN / NONE` | Pass |
| AC-006 | Playwright：点击次 CTA 后进入 Build 首章 | Pass |
| AC-007 | `test_brief_exposes_no_trace_or_execution_channel` 与公开模式请求监听 | Pass |
| AC-008 | Playwright：1440 × 1000、390 × 844 横向溢出均为 0；console/page/request error 均为 0 | Pass |
| AC-009 | 100 项 unittest、Python 编译、4 个 JS 文件语法、`git diff --check` | Pass |
| AC-010 | Render 线上默认速览、三入口与 `/data.json` 404 | Pass（部署提交 `28a4b87`） |
| AC-011 | README、ROADMAP、规格索引与本记录 | Pass |

## 4. 验证命令

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q agent providers tools scripts tests main.py
node --check dashboard/app.js
node --check dashboard/evolution.js
node --check dashboard/lego.js
node --check dashboard/story.js
git diff --check
```

结果：

```text
Ran 100 tests in 1.454s
OK
compile-js-ok
diff-check-ok
```

## 5. 浏览器验收

使用系统 Chrome + Playwright，公开地址为
`http://127.0.0.1:8766/dashboard/?demo=public`。

| 视口 | 默认视图 | 可见标签 | 主 CTA | 横向溢出 | 页面错误 |
|---|---|---|---|---|---|
| 1440 × 1000 | `view-brief` | 3 | 启动基线，结果 `BLOCKED / UNKNOWN / NONE` | 0 | 0 |
| 390 × 844 | `view-brief` | 3 | 启动基线，结果 `BLOCKED / UNKNOWN / NONE` | 0 | 0 |

布局测量：

- 桌面 Hero：`top=163.8px`，`bottom=606.5px`，主 CTA 和边界说明均在首屏；
- 手机 Hero：`top=141.6px`，`bottom=831.9px`，在 844px 首屏内完整呈现；
- 两种视口 `document.documentElement.scrollWidth === clientWidth`。

本地完整模式使用 `http://127.0.0.1:8766/dashboard/` 与已有 `data.json` 验证：

- 状态卡显示“真实 Trace 已接通 / 3 次运行”；
- Build、Learn、Story、Replay、Anatomy、Compare、Lego 七视图均能切换并渲染内容；
- 可见标签数为 7，Brief 不可见；
- 全部视图横向溢出为 0，console/page error 为 0；
- 从 Build 按右方向键后进入 Learn，焦点与激活标签一致。

## 6. 计划与实际偏差

1. **规格回填**：Brief 的 HTML 叙事骨架先于 Spec/Plan 落地。完成部分骨架后转为规格、测试、入口和验收收敛。这是一次流程偏差，不把回溯补全当作后续先写代码的先例。
2. **CTA 行为更直接**：计划只要求连接到乐高，实际主 CTA 在切换后立即运行空装配基线，减少“进入工作台后不知道点哪里”的空转。文案同步改为“一键运行基线实验”。
3. **没有单独 landing page**：沿用单页状态机，避免双份 DOM、样式和状态漂移。

## 7. 已知限制

- “工程正确性”只覆盖确定性测试、契约和边界，不证明真实模型质量。
- “教学有效性”尚未开展用户实验，不能证明初学者理解或记忆有统计提升。
- “Agent 效果”来自确定性机制模拟，不代表真实任务成功率。
- “生产安全”只说明公开页面零执行通道，不代表 OS/容器隔离、配额、监控或生产稳定性。
- 手机端完整内容较长，但首屏主行动可见且全页无横向溢出；本轮不评估滚动深度对完成率的影响。

## 8. 失败与负面结果

- 本轮没有真实用户样本，因此无法给出“阅读时间降低”“理解正确率提升”等教学收益结论。
- 100 项测试通过不能转化为 Agent 成功率或招聘转化率。
- 公开模式只做页面请求短路；数据不公开的最终保证仍依赖 `.gitignore` 与 Render 仅发布 `dashboard/` 静态代码。部署后已复核线上 `/data.json` 返回 404，但该结论针对当前静态发布配置，不代表未来新增路由或后端后仍自动成立。

## 9. Render 线上验收

- 部署提交：`28a4b87`；确认时间：2026-10-30 11:04 Asia/Shanghai。
- 线上地址：<https://mini-agent-harness.onrender.com/>。
- 页面内容标记：`THE 90-SECOND STORY` 与“一键运行基线实验”均已上线。

| 检查 | 1440 x 1000 | 390 x 844 |
|---|---|---|
| 默认视图 | `view-brief` | `view-brief` |
| 公开入口 | 3 个；Build/Lego 均可进入 | 3 个；Build/Lego 均可进入 |
| 主 CTA | `BLOCKED / UNKNOWN / NONE` | `BLOCKED / UNKNOWN / NONE` |
| `data.json` 请求 | 0 | 0 |
| 横向溢出 | 0px | 0px |
| 页面错误 | 0 | 0 |
| Hero 首屏范围 | 163.8-606.5px，完整 | 141.6-831.9px，完整 |

数据边界：

```text
GET https://mini-agent-harness.onrender.com/data.json -> 404
```

该检查只证明当前 Render 静态站没有公开数据文件；不证明未来新增后端、路由或构建配置时仍然安全。

## 10. 后续工作

- 后续每次涉及公开数据或部署配置的变更，重复零 `data.json` 请求与线上 404 检查。
- M2 进入真实评测闭环：固定任务、模型版本、成功率、安全、Token 与失败恢复。
- 若验证教学假设，需单独设计前后测或任务访谈，不以页面自述代替学习效果。

## 11. 完成声明

- [x] 本地实现与规格一致
- [x] 本地验收标准有证据（AC-001–AC-009、AC-011）
- [x] 测试和静态检查完成（100 项通过）
- [x] 安全边界描述准确
- [x] README、ROADMAP、规格索引与实现记录同步
- [x] Render 线上验收完成（AC-010，部署提交 `28a4b87`）
