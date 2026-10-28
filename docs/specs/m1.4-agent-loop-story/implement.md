# m1.4 Agent Loop Story Implementation Record

- Spec：`spec.md`
- Plan：`plan.md`
- Tasks：`tasks.md`
- 状态：Verified
- 实施日期：2026-10-28
- 验证日期：2026-10-28

## 1. 实际交付

Dashboard 的默认视图已从工程结构改为“任务故事”，形成四个可互相追溯的视图：

1. **任务故事**：按 Trace 的 `step` 聚合模型请求、模型决定、工具调用、observation 和最终回答；先给确定性摘要，再按需展开原始证据。
2. **Loop 回放**：逐事件更新环形 Loop，真实显示工具分支、Observation 回写、完成、压缩、审批和异常条件；支持上一步、下一步、播放、暂停与键盘切换。
3. **乐高拆解**：先突出本次真实插入的工具插槽，再在折叠工具箱中保留全部工具契约、Schema、风险、源码和调用入口；不使用“拖拽编排”措辞。
4. **A/B 对比**：把首个结果不同的任务和首个不同 check 提到前部，从两侧直接进入对应真实 Trace；单运行明确提示至少需要两份报告。

所有故事、工具路径、Loop 分支和 A/B 分叉均由 `dashboard/story.js` 从 Trace/checks 确定性派生。页面仍是完全离线的只读投影，不启动 Agent、不执行工具，也不提供在线调参。

## 2. 变更文件

| 文件 | 变更 |
|---|---|
| `dashboard/story.js` | 新增无 DOM 依赖的轮次分组、工具路径、Loop journey、observation 摘要与 A/B 首分叉函数 |
| `dashboard/index.html` | 默认任务故事、四视图导航、轮次/工具插槽/首分叉容器和证据折叠结构 |
| `dashboard/styles.css` | 故事叙事、环形 Loop、乐高装配板、首分叉、折叠证据和移动端样式 |
| `dashboard/app.js` | 接入 story 派生结果，重构故事、回放、工具高亮和 A/B 渲染，保留空数据与 schema 错误态 |
| `tests/test_dashboard_story.py` | 固定轮次与 `call_id` 关联、Loop 分支、A/B 分叉及默认页面结构 |
| `docs/specs/m1.4-agent-loop-story/` | 完整 Spec、Plan、Tasks 与本实施记录 |
| `README.md`、`docs/ROADMAP.md`、`docs/specs/README.md` | 四视图、版本、学习路径与规格索引同步 |
| `main.py` | CLI 版本更新为 `v0.6.0` |

## 3. 验收证据

| AC | 证据 | 结果 |
|---|---|---|
| AC-001 | Playwright 断言默认 `#view-story` 可见，Replay、乐高拆解和 A/B 默认隐藏 | Pass |
| AC-002 | `tests/test_dashboard_story.py` 验证同一 `step` 聚合，`tool_result` 通过 `call_id` 配对；真实任务为 6 轮 | Pass |
| AC-003 | 纯函数验证 `tool → finish`；真实默认任务为 S1-S5 工具回环、S6 完成分支 | Pass |
| AC-004 | 默认故事显示 `read_file ×5`；当前任务没有 `grep` 调用，但 checks 中保留 `tool_not_called:grep` 否定证据；工具箱折叠后仍有 7 个契约 | Pass |
| AC-005 | Playwright 断言原始事件 JSON 与 observation/details 默认关闭，展开后内容可读 | Pass |
| AC-006 | 首分叉定位 `m1_2_failure_recovery`，显示首个不同 check，6 行任务矩阵可展开 | Pass |
| AC-007 | 轮次跳转定位 `Step 1 · model_request`；首分叉左右按钮分别进入 `off` 与 `extractive` 的真实 Trace | Pass |
| AC-008 | Playwright 覆盖空数据、无效 schema、单运行、离线加载与四视图 390px；无横向溢出 | Pass |
| AC-009 | 66/66 Python 测试、JavaScript 语法、Python 编译与 `git diff --check` 全部通过 | Pass |

真实导出基准仍为 3 次运行、18 条任务记录、8 个学习模块和 7 个工具。默认任务 `m1_2_value_retention` 为 6 轮、5 次 `read_file`；这些数字来自既有 M1.2 报告，不是本轮新产生的评测。

## 4. 验证命令

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q agent tools scripts main.py
node --check dashboard/story.js
node --check dashboard/app.js
git diff --check
```

结果：

```text
Ran 66 tests in 0.235s
OK
```

真实页面浏览器验收使用本机 Chrome：

```bash
NODE_PATH=/Users/wly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
node /tmp/m14-dashboard-qa.cjs
```

结果：

```text
M1.4 Browser QA: PASS
story: 6 rounds, read_file x5, real loop S1-S5 tool + S6 finish
replay: node transitions, raw JSON folded, observation folded, play/pause + keyboard
anatomy: 8 modules, 1 installed tool, 7 contracts in folded toolbox
compare: first divergence m1_2_failure_recovery, 6 task rows, both Trace links
single/empty/invalid/390px: PASS
mobile widths: story/replay/anatomy/compare 均为 390 = 390
external requests: 0 runtime errors: 0
```

验收截图：

- `/tmp/m14-qa-story.png`
- `/tmp/m14-qa-anatomy.png`
- `/tmp/m14-qa-compare.png`
- `/tmp/m14-qa-mobile.png`

测试脚本位于临时目录，不随仓库提交；仓库内保留可重复执行的确定性测试。浏览器脚本复用了本地被忽略的 `dashboard/data.json`，因此公开 CI 应先运行导出器准备真实数据。

## 5. 计划与实际偏差

- 视图顺序按学习路径调整为先故事、再回放、再拆解、最后 A/B，而不是保留 M1.3 的原顺序。
- “架构拆解”改名为“乐高拆解”，更直接表达模块和工具插槽，但明确不是拖拽编辑器。
- 增加无效 schema 的浏览器路由验收，补齐 FR-008 中与空数据不同的失败场景。
- 浏览器 QA 仍放在临时脚本而以文字记录结果，没有新增 Playwright 运行时依赖；这是为了不破坏项目“无 npm 运行时依赖”的边界。
- 没有新增 Live Eval，也没有改变 Agent Loop、模型输入、工具 Schema、审批、上下文或压缩行为。

## 6. 已知限制

- `dashboard/data.json` 是 `local-unredacted`，可能包含真实 observation、工具参数或最终回答；字符截断不是脱敏。
- 故事只解释 Trace 记录了什么，不展示也无法证明模型内部动机；checks 是判定证据，不是“模型为什么这样做”的因果解释。
- 旧报告缺少原始自然语言 Prompt 时显示“未记录”，不会补造。
- A/B 首分叉按报告任务顺序定位，是单次快照中的第一个可观察差异，不是统计显著性，也不是因果归因。
- 页面是静态快照，不会自动刷新新报告；更新报告后需要重新运行导出器。
- 未提供受控在线运行和调参，需要另立规格处理工作区、审批、密钥、超时、取消与清理。

## 7. 失败与负面结果

- 当前 `off` 4/6、`extractive` 3/6、`model` 3/6，仍不能证明历史压缩提高成功率；本轮不改变这一结论。
- 默认任务的故事和已用零件中不出现 `grep`，但 checks 确实记录了 `tool_not_called:grep`。该否定证据必须保留，不能为了“工具路径整洁”而删除。
- 工具详情按“当前运行”聚合，`off` 运行共有 29 次 `read_file`；故事页的 `read_file ×5` 是当前任务的范围，两者统计口径不同，文案已分别标注。
- 全页截图中的 sticky header 出现在页面中部，是 full-page 截图对 sticky 元素的表现，不是实际滚动布局缺陷。

## 8. 后续工作

- M2：升级到 `apply_patch`，建立“修改 → 自动测试/读取校验 → 根据错误修复”的验证闭环。
- 为压缩证据时序、重复值和多次重复实验另立规格，避免把单次快照当稳定收益。
- 若要在线调参或受控运行，必须先设计临时 workspace、审批、密钥、超时、取消、成本预算和进程清理。
- 若要公开 Dashboard，先单独实现脱敏导出；不能直接发布本地 `data.json`。

## 9. 完成声明

- [x] 实现与规格一致
- [x] 验收标准有证据
- [x] 测试和静态检查完成
- [x] 安全边界描述准确
- [x] 文档已同步
