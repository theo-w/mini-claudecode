# m1.5 Agent Causal Explainer Implementation Record

- Spec：`spec.md`
- Plan：`plan.md`
- Tasks：`tasks.md`
- 状态：Verified
- 实施日期：2026-10-28
- 验证日期：2026-10-28

## 1. 实际交付

M1.5 把默认“任务故事”从 Trace 播放器补成一条可验证的机制解释链，顺序为：

1. **实验结论**：先给出任务状态、真实工具路径和结果摘要；
2. **问题与任务契约**：解释实验要验证什么、Prompt、禁止路径、fixture 设计和成功标准；
3. **可观察因果链**：把连续 5 次分页读取折叠为一个 S1–S5 episode，同时保留每个真实 step 与 Replay 入口；
4. **分组 checks**：按最终验收、过程约束、能力证据、实验完整性解释每个 check 阻止什么伪成功；
5. **停止与交付**：用“无 `tool_calls` 的 `model_response`”证明停止分支，而不是推测模型动机；
6. **机制 takeaways**：给出 5 条由当前 Trace 支持的结论，并标明单次 A/B 不能证明策略因果。

导出器新增可重复 `--tasks`，把任务 Prompt、checks、`max_steps` 和 fixture 确定性摘要写入可选顶层 `task_contracts`。fixture 摘要只保留文件路径、行数、组成与重复块，不导出 fixture 正文。

前端新增的 fixture、check 分类/分组、字段匹配因果边、episode 聚合和实验总结均由 `dashboard/story.js` 确定性生成。Story、Replay 与 A/B 统一使用 `✓ PASS / × FAIL / → SKIP / ? UNKNOWN`，不再把 `skipped=off` 显示为绿色通过。

本次没有新增 Live Eval，也没有改变 Agent Loop、Prompt、模型、工具 Schema、审批、上下文或压缩行为；复用的是既有 M1.2 三份报告和固定任务集。页面仍是离线的只读投影，没有工具执行、写文件、网络请求或在线调参入口。

## 2. 变更文件

| 文件 | 变更 |
|---|---|
| `scripts/export_dashboard.py` | 支持可重复 `--tasks`；读取、合并并校验任务契约；生成 fixture 行数、组成与重复块摘要，不导出正文 |
| `dashboard/story.js` | 新增 observation metadata 解析、fixture 摘要、check 分类/分组、字段匹配因果链、连续 episode 聚合与实验总结纯函数 |
| `dashboard/app.js` | 接入实验 hero、问题/契约卡、因果链、episode、分组 checks 与 takeaways；统一三处状态语义并保留旧数据降级 |
| `dashboard/index.html` | 增加实验问题、因果链和机制结论的教学容器，调整 Story 叙事顺序 |
| `dashboard/styles.css` | 增加实验卡、fixture 视觉、因果边、episode、check 教学卡、takeaways 与 1180/900/700/520px 响应式样式 |
| `tests/test_agent_anatomy.py` | 覆盖任务契约导入、fixture 摘要、正文排除、重复合并、冲突拒绝与 CLI `--tasks` |
| `tests/test_dashboard_story.py` | 覆盖强边边界、字段不匹配、连续分页、check 分组、SKIP/UNKNOWN 与页面结构 |
| `docs/specs/m1.5-agent-causal-explainer/` | 完整 Spec、Plan、Tasks 与本实施记录 |
| `README.md`、`docs/ROADMAP.md`、`docs/specs/README.md` | 同步版本、能力、导出命令、学习路线与规格索引 |
| `main.py` | CLI 版本更新为 `v0.7.0` |

## 3. 验收证据

| AC | 证据 | 结果 |
|---|---|---|
| AC-001 | 真实导出包含 6 个 task contract；默认 fixture 为 `24 × 4 + 3 = 99` 行；序列化契约不包含 fixture 正文 | Pass |
| AC-002 | `test_merge_task_contracts_accepts_equal_and_rejects_conflicting_duplicates` 覆盖同 ID 相同内容合并与不同内容报错 | Pass |
| AC-003 | Playwright 拦截删除 `task_contracts` 的数据：页面显示“未导入任务契约”，不显示 fixture 组成；其余三视图正常 | Pass |
| AC-004 | 默认任务显示 Prompt、99 行 fixture、禁止 `grep` 的过程约束与最终验收标准 | Pass |
| AC-005 | 默认任务聚合为 S1–S5 一个 episode；展开后 5 个真实 step、5 个 Replay 跳转按钮，默认再次折叠 | Pass |
| AC-006 | 默认任务生成 4 条强字段边；页面显示 `Observation.next_start_line=22 → 下一次 tool_call.start_line=22`，并标注“内部动机未记录” | Pass |
| AC-007 | 默认 5 个 checks 被分为 4 组；compaction 检查显示 `→ SKIP` 与“策略关闭”，不是 PASS | Pass |
| AC-008 | Story、Replay、A/B 均使用形状 + 文字状态；页面包含 5 张 takeaway 卡和单次 A/B 边界说明 | Pass |
| AC-009 | 74/74 Python 测试、Python 编译、两个 JavaScript 语法检查和 `git diff --check` 全部通过 | Pass |
| AC-010 | Playwright 覆盖 1440px 与 390px 四视图；无横向溢出、runtime error=0、external request=0；单运行 A/B 显示“当前只有一份实验报告” | Pass |

真实导出基准：

```text
3 次运行、18 条任务记录、7 个工具、6 份任务契约
默认任务 m1_2_value_retention
fixture audits-m12.log: 24 × 4 + 3 = 99 行
S1: 1–21, next_start_line=22
S2: 22–42, next_start_line=43
S3: 43–63, next_start_line=64
S4: 64–84, next_start_line=85
S5: 85–99, has_more=false
S6: 无 tool_calls 的停止响应
checks: 4 PASS / 1 SKIP / 0 FAIL / 0 UNKNOWN
```

浏览器 Step 跳转实测：

```text
桌面：事件 4 / 24 · Step 1 · tool_call
390px：事件 4 / 24 · Step 1 · tool_call
```

## 4. 验证命令

```bash
python3 scripts/export_dashboard.py \
  evals/results/m1_2-off-final-20261028.json \
  evals/results/m1_2-extractive-final-20261028.json \
  evals/results/m1_2-model-final-20261028.json \
  --labels off extractive model \
  --tasks evals/m1_2_tasks.json \
  --output dashboard/data.json

python3 -m unittest discover -s tests -v
python3 -m compileall -q main.py agent providers tools scripts tests
node --check dashboard/story.js
node --check dashboard/app.js
git diff --check
```

测试结果：

```text
Ran 74 tests in 0.415s
OK
```

浏览器验收使用本地 Chrome、Playwright 和临时脚本 `/tmp/m1.5-browser-qa.js`。桌面与移动端结果：

```text
story/replay/anatomy/compare @ 1440px: scrollWidth=1440, overflow=false
story/replay/anatomy/compare @ 390px:  scrollWidth=390,  overflow=false
legacy data @ 390px: “未导入任务契约”，四视图 overflow=false
single run @ 390px: “当前只有一份实验报告”，overflow=false
runtime errors: 0
console errors: 0
external requests: 0
failed requests: 0
```

验收截图：

- `/tmp/m1.5-desktop-story.png`
- `/tmp/m1.5-mobile-story.png`
- `/tmp/m1.5-mobile-replay.png`
- `/tmp/m1.5-mobile-anatomy.png`
- `/tmp/m1.5-mobile-compare.png`
- `/tmp/m1.5-mobile-legacy-story.png`
- `/tmp/m1.5-mobile-single-compare.png`

Playwright 脚本仍是临时 QA 工具，不随仓库提交，避免引入 npm 运行时依赖。仓库内保留可重复执行的 Python/Node 纯函数与结构测试；浏览器脚本复用本地被忽略的 `dashboard/data.json`。

## 5. 计划与实际偏差

- 计划把 Story 平铺轮次压到不超过 4 个 episode 摘要；实际默认任务保留一个 S1–S5 continuation episode，并继续单独展示 S6 停止与最终结果卡，真实轮次明细仍可展开。没有删除任何 step。
- 计划提到统一 A/B check 语义；实际同时补上了缺失 check 的 `? UNKNOWN / 缺失`，避免把“没有数据”渲染成通过。
- 浏览器验收没有新增 Playwright 项目依赖，继续使用临时脚本和本地 Chrome。这是对“无 npm 运行时依赖”边界的遵守。
- 没有新增 Live Eval。M1.5 只改变静态导出与解释层，无法产生新的成功率和成本证据。
- 真实导出数据仍来自 M1.2 既有报告，因此没有把 M1.5 写成一次新的策略实验。

## 6. 已知限制

- 任务契约需要维护者显式传入 `--tasks`；报告路径不会被用于猜测任务文件。缺少契约时只显示“未导入任务契约”。
- `dashboard/data.json` 是 `local-unredacted`，可能包含真实 Prompt、observation、工具参数或最终回答；字符截断不是脱敏，禁止提交或公开分享。
- 强边只证明消息里出现了相同字段值，不证明模型“因为”该值而继续；页面固定保留“内部动机未记录”的边界。
- 单次 A/B 只能定位可观察路径差异，不能证明压缩策略与结果之间存在统计因果。
- check 分类基于当前已知 check 语法；未知类型进入“其他检查”并显示 UNKNOWN，不自动补造解释。
- fixture 摘要只回答规模和结构，不能证明 fixture 内容一定足以完成任务；相同 task ID 需要人工保证契约一致。
- 页面是静态快照，导出新报告后需要重新运行导出器并刷新。

## 7. 失败与负面结果

- M1.2 的既有结果仍是 `off` 4/6、`extractive` 3/6、`model` 3/6；M1.5 没有提高成功率，也不能宣称压缩有效。
- 默认任务的 compaction check 实际为 SKIP，因为当前策略是 `off`。这是一个重要的负面证据：不能把“没有压缩”解释成“压缩成功”。
- 因果链只形成 4 条强边，对应 S1→S2、S2→S3、S3→S4、S4→S5；没有为了视觉完整而伪造 S5→S6 的字段边，S6 以“无 `tool_calls`”单独呈现停止证据。
- 全页截图中的 sticky header 可能出现在页面中部，这是 full-page 截图对 sticky 元素的渲染表现；实际 390px 与 1440px 滚动布局均无横向溢出。

## 8. 后续工作

- 进入 M2：增加 `apply_patch`，建立“修改 → 自动测试/读取校验 → 根据错误修复”的验证闭环。
- 若要解释跨文件证据时序和多次压缩失真，另立规格，不在当前单任务 episode 中扩展成推测。
- 若需要在线调参或受控运行，必须先设计临时 workspace、审批、密钥、超时、取消、成本预算和进程清理。
- 若要公开 Dashboard，先实现独立脱敏导出；不能直接发布当前 `data.json`。

## 9. 完成声明

- [x] 实现与规格一致
- [x] 验收标准有证据
- [x] 测试和静态检查完成
- [x] 安全边界描述准确
- [x] 文档已同步
