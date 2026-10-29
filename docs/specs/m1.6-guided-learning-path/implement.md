# m1.6 Agent Guided Learning Path Implementation Record

- Spec：`spec.md`
- Plan：`plan.md`
- Tasks：`tasks.md`
- 状态：Verified
- 实施日期：2026-10-29
- 验证日期：2026-10-29

## 1. 实际交付

M1.6 把 Dashboard 的默认入口从“证据报告”改为一条面向初学者的五步学习路径：

1. **看结论**：用“任务 / 过程 / 断点 / 裁判”四张故事卡复述一次真实运行；
2. **认零件**：用主轨、条件插件、旁路证据三条车道展示任务、Context、Model、Loop、Finish、Tool、Approval、Compaction、Trace 与 Eval，每张卡可展开查看作用、进入时机、架构位置、本次状态和源码入口；
3. **看循环**：用 S1–S3 三张摘要卡展示 `model_response → tool / finish → Observation`，并明确 S3 是可观察断点；
4. **懂测试**：把最终验收、过程约束、能力证据、实验完整性分成四类问题，分别说明“问什么、本次结果、能证明、不能证明”；
5. **做复盘**：给出四条由当前 Trace 支持的 takeaways、证据边界和四个深挖入口。

默认学习任务仍是既有 M1.2 真实记录 `m1_2_todo_fixme`。可观察到：

```text
文件：audit-todo.log，共 85 行
S1：read_file 读取 1–22 行，next_start_line=23
S2：read_file 读取 23–44 行，has_more=false，file_has_more=true，next_start_line=45
S3：model_response 的 tool_calls=[]，Loop 进入 finish
最终验收：0/3 PASS，整体 FAIL
能力证据：2 项 PASS
实验完整性：1 项 SKIP
checks 总数：7
```

因此页面可以直接解释一个关键差异：工具确实执行过，能力证据可以通过；但 Agent 只读到第 44 行就停止，最终答案没有交付完整验收结果。Trace 能证明续读线索出现后下一轮没有调用工具，不能证明模型内部为什么停止。

同时修正了 `observationSummary`：`has_more` 表示本次请求范围是否还有后续，`file_has_more` 表示文件是否还有后续。`has_more=false + file_has_more=true + next_start_line=45` 不再被错误显示成“已到文件末尾”。

本次没有改变 Agent runtime、Prompt、模型、工具 Schema、审批、上下文或压缩策略；没有新增 Live Eval。页面仍读取既有 `data.json`，不增加后端、网络请求、CDN、npm 依赖或工具执行入口。

## 2. 变更文件

| 文件 | 变更 |
|---|---|
| `dashboard/index.html` | 将 `开始学习` 设为默认 Tab；增加五步路径、任务选择器和四个深挖视图入口，保留 Story、Replay、Anatomy、Compare |
| `dashboard/app.js` | 增加学习状态、四张故事卡、10 张组件卡、Loop 摘要、断点提示、四类测试表、复盘与深挖跳转；将 DOM 辅助函数改为 variadic，避免嵌套 Node 被字符串化 |
| `dashboard/story.js` | 修复 observation 分页摘要；新增 `continuationGap` 纯函数 |
| `dashboard/styles.css` | 增加学习路径、装配轨道、Loop 卡、测试表、证据抽屉和 390px 响应式样式 |
| `tests/test_dashboard_story.py` | 新增分页语义与 continuation gap 测试；将默认视图结构测试改为五步学习路径并验证原始证据默认折叠 |
| `docs/specs/m1.6-guided-learning-path/` | 完整 Spec、Plan、Tasks 与本实施记录 |
| `README.md`、`docs/ROADMAP.md`、`docs/specs/README.md` | 同步 v0.8.0、学习路径用法、M1.6 阶段与规格索引 |
| `main.py` | CLI 版本更新为 `v0.8.0` |

## 3. 验收证据

| AC | 证据 | 结果 |
|---|---|---|
| AC-001 | HTML 只有一个 active Tab 且 `data-view="learn"`；Playwright 验证五步按钮均可切换，其余四个视图默认 hidden | Pass |
| AC-002 | Playwright 在 1440px 与 390px 下遍历五步；`document.scrollWidth` 与 `body.scrollWidth` 均不超过 viewport，运行/任务选择器可用 | Pass |
| AC-003 | 默认任务第一步显示任务、过程、断点、裁判四张卡；正文包含 S3、第 44 行、最终验收 0/3 与整体 FAIL；四类 checks 在折叠证据中分层 | Pass |
| AC-004 | 组件轨道包含 Task、Context、Model、Loop、Finish、Tool、Approval、Compaction、Trace、Eval 共 10 张卡；每张展开后有四项解释与源码入口；Tool 卡还显示 `Model → Agent Loop → Approval? → ToolRegistry → handler → observation` 接线和实际调用次数 | Pass |
| AC-005 | Step 3 显示 3 张轮次卡；断点卡包含 `file_has_more=true`、第 45 行和 S3 停止；S3 跳转进入 Replay 的 Step 3 | Pass |
| AC-006 | 四类测试表均展示问题、结果、能证明与不能证明；四个逐条 check 抽屉默认关闭，展开后可见证据 | Pass |
| AC-007 | 复盘显示 4 张 takeaway 卡、4 个深挖入口以及“这次实验能说 / 不能说”边界 | Pass |
| AC-008 | Node 单元测试断言“文件仍有后续”“第 45 行”，且不包含“已到文件末尾”；文件结束时仍显示“已到文件末尾” | Pass |
| AC-009 | Node 单元测试：下一轮停止时返回 `fromStep=1`、`nextStep=2`、`returnedRange=23-44`、`nextStartLine=45`、`totalLines=85`；下一轮继续调用工具时返回 `null` | Pass |
| AC-010 | 76/76 Python 测试、Python 编译、两个 JavaScript 语法检查和 `git diff --check` 全部通过 | Pass |

## 4. 验证命令

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q main.py agent providers tools scripts tests
node --check dashboard/app.js
node --check dashboard/story.js
git diff --check
```

测试结果：

```text
Ran 76 tests in 0.488s
OK
```

浏览器验收使用本地 Chrome、Playwright 和临时脚本 `/tmp/m1.6-qa-full.js`。结果：

```text
status: PASS
学习步骤：5
组件卡：10
桌面：1440px，五步 overflow=false
移动端：390px，五步 overflow=false
键盘：Tab 与步骤按钮 Enter 切换通过
S3 → Replay：定位 Step 3
console errors: 0
page errors: 0
external requests: 0
```

验收截图：

- `/tmp/m1.6-clean-desktop-step1.png`
- `/tmp/m1.6-clean-desktop-step2.png`
- `/tmp/m1.6-clean-desktop-step3.png`
- `/tmp/m1.6-clean-desktop-step4.png`
- `/tmp/m1.6-clean-desktop-step5.png`
- `/tmp/m1.6-clean-mobile-step1.png`
- `/tmp/m1.6-clean-mobile-step4.png`

Playwright 脚本只作为临时 QA 工具，不随仓库提交，避免把浏览器运行时变成项目依赖。仓库内保留可重复执行的 Python/Node 纯函数与静态结构测试；浏览器脚本复用 Git ignored 的 `dashboard/data.json`。

## 5. 计划与实际偏差

- 计划第一步使用“三句话结论”；实际改为“任务 / 过程 / 断点 / 裁判”四张故事卡。原因是“过程”和“断点”需要分开，否则初学者容易把“Loop 停止”误解成“任务已经完成”。
- 计划组件地图覆盖 9 个组件/证据节点；实际把 `Finish / Stop` 作为独立主轨出口，共 10 张卡，让“什么条件下退出 Loop”在装配图上可见。
- 实际学习视图同时生成四条 takeaways，比规格要求的至少三条多一条，用来说明“能力 PASS 不等于任务交付 PASS”。
- 浏览器验收仍未引入 Playwright 项目依赖，继续使用临时脚本与本地 Chrome。
- 没有新增 Live Eval；所有展示数据来自既有 M1.2 导出报告。

## 6. 已知限制

- 学习路径基于单次 Trace，只能解释这次运行的可观察行为，不能形成成功率或因果结论。
- `continuationGap` 只能证明续读字段出现后下一轮没有调用工具，不能证明模型的内部动机。
- 组件“本次状态”只对当前 record 成立；组件存在于 catalog 中不代表本次参与。
- 指标卡只解释路径和成本，不参与最终裁判；Token、调用次数、耗时都不能替代 checks。
- `SKIP` 表示本次没有验证，不等于 PASS；能力证据 PASS 也不等于最终任务交付 PASS。
- `dashboard/data.json` 是 `local-unredacted`，可能包含真实 Prompt、observation 或最终回答；字符截断不是脱敏，禁止提交或公开分享。
- 页面是静态快照，导入新报告后需要重新运行导出器并刷新。

## 7. 失败与负面结果

- 默认任务的最终验收是 `0/3`，整体 FAIL；页面没有因为两次工具调用成功而隐藏失败。
- S2 返回 `file_has_more=true` 和 `next_start_line=45`，但 S3 没有继续调用工具。这是本次最直接的可观察断点，不是“已经读完整份文件”。
- 能力证据 `PASS 2` 与最终验收 `FAIL 3` 同时成立，说明“工具会执行”与“任务已完成”是两个不同问题。
- 实验完整性 `SKIP 1` 被保留为未验证，没有为了视觉完整把它算作 PASS。
- M1.6 没有新增实验，因此不能从这次界面重构推导任何 Agent 能力提升。

## 8. 后续工作

- 进入 M2：增加 `apply_patch`，建立“修改 → 自动测试/读取校验 → 根据错误修复”的验证闭环。
- 若需要研究模型停止原因，需要单独设计可观测实验，不能从现有 Trace 补写思维链。
- 若要在线调参或受控运行，必须先设计临时 workspace、审批、密钥、超时、取消、成本预算和进程清理。
- 若要公开 Dashboard，先实现独立脱敏导出；不能直接发布当前 `data.json`。

## 9. 完成声明

- [x] 实现与规格一致
- [x] 验收标准有证据
- [x] 测试和静态检查完成
- [x] 安全边界描述准确
- [x] 文档已同步
