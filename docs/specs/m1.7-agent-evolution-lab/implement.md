# Agent Evolution Lab Implementation Record

- Spec：`spec.md`
- Plan：`plan.md`
- Tasks：`tasks.md`
- 状态：Verified
- 实施日期：2026-10-29
- 验证日期：2026-10-29

## 1. 实际交付

M1.7 在现有 Dashboard 前增加了一个默认入口 `00 从零建造`。它不从组件清单开始，而是让旧版本先撞墙，再用一个最小补丁解决问题：

1. **只有模型**：模型能生成文字，但不能读取本地文件，也不能执行测试；
2. **加第一个 Tool**：Tool Schema 让模型可以请求动作，但执行结果还没有形成闭环；
3. **Tool Loop**：把 `tool_result` 写回消息历史，模型才能基于 Observation 决定下一步；
4. **Tool Registry**：把不断增长的 `if/elif` 变成可注册、可校验的工具表；
5. **安全边界**：字符串黑名单不是安全边界，审批是策略闸门，但审批也不等于 Sandbox；
6. **Trace**：记录可观察行为，区分“实际发生”与“事后解释”；
7. **Eval**：用任务契约和 checks 判断是否交付，明确能力证据 `PASS` 不等于任务 `PASS`，`SKIP != PASS`。

每章沿用同一教学节奏：

```text
旧版本撞墙
→ 暴露具体问题
→ 加最小补丁
→ 看确定性教学快照
→ 解释为什么需要
→ 说明能力边界
→ 回答检查题
```

第 7 章额外展示 Tool 与 Skill 的区别和后续路线。Tool 被定义为一次原子执行能力；Skill 被定义为可复用的流程知识。Skill 以 Tool、Trace、Eval 为前置条件，只作为后续路线展示，不进入当前 Runtime。

课程数据在 `dashboard/evolution.js` 中，页面交互在 `dashboard/app.js` 中。课程是完全静态、只读的 DOM 与教学数据：不调用模型、不执行工具、不读取真实 observation、不新增 Live Eval。`dashboard/data.json` 存在时，页面显示“真实 Trace 已接通”；缺失或返回 404 时，基础课仍可完整阅读，进入真实解剖后才显示导出提示。

## 2. 变更文件

| 文件 | 变更 |
|---|---|
| `dashboard/evolution.js` | 新增 7 章课程、每章痛点/补丁/确定性快照/边界/唯一答案检查题、Tool vs Skill 对照、后续路线和 5 条结论 |
| `dashboard/index.html` | 新增默认 `00 从零建造` 导航与视图骨架；保留真实解剖、任务故事、Loop 回放、乐高拆解和 A/B 对比 |
| `dashboard/app.js` | 增加课程状态、章节渲染、装配进度、答题反馈、键盘聚焦、无数据降级与真实解剖入口 |
| `dashboard/styles.css` | 增加实验台课程视觉、章节轨道、装配栈、代码/终端快照、Tool/Skill 卡、后续路线与 390px 响应式样式 |
| `tests/test_evolution_course.py` | 新增 4 项确定性测试：章节顺序、失败驱动语义、安全/评测边界、页面契约 |
| `tests/test_dashboard_story.py` | 将旧的“默认五步学习”结构契约更新为“默认从零建造”，保留五步学习、原始证据折叠与数据加载检查 |
| `docs/specs/m1.7-agent-evolution-lab/` | 完整 Spec、Plan、Tasks 与本实施记录 |
| `README.md`、`docs/ROADMAP.md`、`docs/specs/README.md` | 同步 v0.9.0、无数据体验方式、M1.7 路线和规格索引 |
| `main.py` | CLI 版本更新为 `v0.9.0` |

## 3. 验收证据

| AC | 证据 | 结果 |
|---|---|---|
| AC-001 | Playwright 默认进入 `从零建造`，7 个章节按钮存在；课程首屏不依赖 `data.json` | Pass |
| AC-002 | Playwright 遍历 01 → 07，标题与数据中的章节标题逐一相等；上一章、下一章和侧栏均可切换 | Pass |
| AC-003 | 每章只有一个正确选项；Playwright 先选错误答案看到解释，再选正确答案，进度从 `0 / 7` 变为 `1 / 7` | Pass |
| AC-004 | 数据测试断言第 1–3 章串起 `Model → Tool Schema → tool_result → Tool Loop`，并区分“能请求”与“能闭环” | Pass |
| AC-005 | 数据测试断言安全章节包含黑名单限制、审批、workspace、`shell=False` 与 Sandbox 边界；页面不展示攻击命令 | Pass |
| AC-006 | 数据测试断言 Trace 记录行为、Eval 判断结果、能力证据不替代最终验收，并明确 `SKIP != PASS` | Pass |
| AC-007 | 第 7 章显示 2 张 Tool/Skill 对照卡和 5 张后续路线卡；Skill 标记为 `LATER`，依赖 Tool、Trace、Eval | Pass |
| AC-008 | 正常数据下可打开真实解剖；拦截 `data.json` 为 404 后课程仍可读，进入真实解剖会看到导出提示，“返回从零建造”可用 | Pass |
| AC-009 | 源码断言不存在 `ANTHROPIC_API_KEY`、`child_process`、`rm -rf`；页面没有模型调用或工具执行入口 | Pass |
| AC-010 | 80/80 Python 测试、Python 编译、3 个 JavaScript 语法检查和 `git diff --check` 通过；1440px/390px 无横向溢出 | Pass |

## 4. 验证命令

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q main.py agent providers tools scripts tests
node --check dashboard/app.js
node --check dashboard/story.js
node --check dashboard/evolution.js
git diff --check
```

确定性测试结果：

```text
Ran 80 tests
OK
```

浏览器验收使用本地 Chrome、Playwright 和临时脚本 `/tmp/m1_7_browser_qa.js`。结果：

```text
desktop:
  chapters: 7
  default view: build
  progress after wrong + correct answer: 1 / 7
  viewport/document width: 1440 / 1440
  real trace view: open
  console errors: 0
  page errors: 0
  external requests: 0

mobile:
  viewport/document width: 390 / 390
  chapter 07: reachable
  Tool/Skill cards: 2
  roadmap cards: 5
  console errors: 0
  page errors: 0
  external requests: 0

missing data.json:
  course available: true
  data status: missing
  export guidance: visible
  return to course: works
```

缺失数据分支由 Playwright 主动将 `data.json` 返回为 404，因此浏览器会保留一条预期的资源 404 记录；这不是应用 JavaScript 异常。正常数据分支的 console error 和 page error 均为 0。验收截图：

- `/tmp/m1-7-desktop.png`
- `/tmp/m1-7-mobile.png`

Playwright 脚本不随仓库提交，避免引入新的浏览器运行时依赖；仓库内保留可重复执行的 Python/Node 确定性测试。

## 5. 计划与实际偏差

- 原计划只替换默认视图片段；实现时为了让翻页后的键盘焦点真正落到章节标题，新增 `id="build-chapter-title"` 和 `tabIndex=-1`，并保留可见焦点环。
- 旧的 M1.6 结构测试仍要求 `learn` 为默认 Tab。M1.7 将默认入口按规格改为 `build` 后，同步更新该测试契约；真实解剖、五步学习和原始证据折叠断言继续保留。
- 首轮全量回归为 79/80，通过失败定位到上述旧默认视图契约；修正测试后 80/80 通过。没有通过跳过或删除旧功能来让测试变绿。
- 课程检查题状态只保存在当前页面内存中，刷新后重新开始；本期不引入 `localStorage`，避免把学习进度误当成持久化实验记录。
- 课程是确定性教学快照，不执行用户输入，也不声称是本次模型调用结果。

## 6. 已知限制

- 页面是静态课程，不是可执行 Playground；真正 Try it 需要独立 workspace、Sandbox、审批、超时、取消和进程清理设计。
- 7 章内容验证的是教学概念和页面行为，不是模型能力；本次没有新增 Live Eval，因此不能报告成功率或 Token 收益。
- 教学代码用于解释协议形状，不等同于完整生产 Harness；真实行为仍应以 Trace、Eval 和源码为准。
- 不展示可直接运行的攻击指令；安全章节只说明防御原则和边界。
- `dashboard/data.json` 是 `local-unredacted`，可能含真实 Prompt、observation 或最终回答；字符截断不是脱敏，禁止提交或公开分享。
- 页面不提供网页 Shell、文件写入、API Key 输入或外部 CDN 依赖。

## 7. 失败与负面结果

- 首轮回归暴露了一个真实的产品契约冲突：旧测试把 `learn` 当作默认入口，新课程要求 `build` 作为默认入口。处理方式是更新测试描述并保留旧视图断言，而不是删除旧视图。
- 无数据测试中，浏览器会记录预期的 `data.json` 404。页面将其转换为课程可用状态和明确导出提示；没有出现应用异常或空白页。
- 课程不会把“页面能显示”当作 Agent 能力通过；所有章节输出明确标注为教学快照，最终仍要求回到真实 Trace 和 Eval。
- `SKIP != PASS`、审批不等于 Sandbox、能力 PASS 不等于任务 PASS 继续作为不可弱化的边界。

## 8. 后续工作

- 用独立规格设计 Skill 层：触发条件、版本化、流程知识、可复用边界和与 Tool/Eval 的关系。
- 若要加入 MCP、RAG、Memory 或 Subagent，先分别说明“为什么现在需要”和“新增了什么失败模式”。
- 可执行课程需要独立 Sandbox，不应在现有静态只读页面中直接开放 Shell。
- 下一阶段进入 M2 验证闭环：`apply_patch`、修改后自动测试和根据错误继续修复。

## 9. 完成声明

- [x] 实现与规格一致
- [x] 验收标准有证据
- [x] 测试和静态检查完成
- [x] 安全边界描述准确
- [x] 文档已同步
