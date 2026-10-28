# m1.3 Agent Anatomy Implementation Record

- Spec：`spec.md`
- Plan：`plan.md`
- Tasks：`tasks.md`
- 状态：Verified
- 实施日期：2026-10-28
- 验证日期：2026-10-28

## 1. 实际交付

已交付“Python 只读导出器 + 原生静态网页”的 Agent Anatomy：

- `agent/anatomy.py` 从真实 `ToolRegistry` 生成 7 个工具目录，并定义 8 个学习模块及其连接；
- 每个工具包含说明、JSON Schema、风险等级、审批要求、handler 源码文件和行号；
- 工具详情可列出报告中的真实调用，并跳转到对应的 Loop 事件；
- Loop 视图逐事件回放 `model_response`、`tool_call`、`tool_result`、`history_compaction` 和 `run_finished`，支持上一步、下一步、选择、播放与暂停；
- 回放区展示上下文/Token 曲线、事件详情和任务 checks；
- A/B 视图支持报告交换与选择，展示配置差异、成功率、Token、耗时、步数、压缩/回退和逐任务 checks；
- 新工具生命周期事件写入 `call_id`；旧报告通过 step、工具名和参数进行确定性推断并标记 `call_id_source=inferred`；
- 无 `dashboard/data.json` 时显示导出命令，不生成演示数据；
- 页面不提供模型调用、工具执行、任意 workspace 或自由工作流编排。

真实导出使用 3 份已有 M1.2 报告：

| 运行 | 任务 | 总模型 Token | 平均步数 | 压缩次数 | 回退 |
|---|---:|---:|---:|---:|---:|
| `off` | 4/6 | 68,087 | 5.67 | 0 | 0 |
| `extractive` | 3/6 | 40,340 | 4.67 | 16 | 0 |
| `model` | 3/6 | 134,846（主模型 58,480 + 摘要模型 76,366） | 6.33 | 26 | 12 |

这些值来自既有单次 Live Eval 快照，用于验证 Dashboard 的数据读取和对比能力，不构成新的成功率或因果结论。

## 2. 变更文件

| 文件 | 变更 |
|---|---|
| `agent/anatomy.py` | 学习模块目录、真实工具反射和源码定位 |
| `agent/loop.py` | 工具参数错误、审批拒绝、调用和结果事件附加 `call_id` |
| `scripts/export_dashboard.py` | 多报告读取、字段 allowlist、旧 Trace 关联、内容上限和 JSON 导出 |
| `dashboard/index.html` | 架构、Loop、对比三视图和空状态 |
| `dashboard/styles.css` | 卡片、模块地图、时间线、指标和移动端布局 |
| `dashboard/app.js` | 数据加载、筛选、工具详情、回放和 A/B 渲染 |
| `tests/test_agent_anatomy.py` | 目录、导出、隐私、legacy 关联、空报告和 CLI 测试 |
| `tests/test_agent_loop.py` | `call_id` 协议断言 |
| `.gitignore` | 忽略 `dashboard/data.json` |
| `README.md`、`docs/ROADMAP.md`、`docs/specs/README.md` | 使用方式、版本、路线和边界同步 |
| `docs/decisions/ADR-004-read-only-agent-anatomy.md` | 只读投影与无执行入口决策 |
| `main.py` | CLI 版本更新为 v0.5.0 |

## 3. 验收证据

| AC | 证据 |
|---|---|
| AC-001 | `test_catalog_uses_real_registry` 和 `test_catalog_contains_learning_modules_and_connections` 通过；导出包含 7/7 工具和 8 个模块。 |
| AC-002 | CLI 从仓库根目录导出 3 份报告：3 runs、18 records、3 个选择项，全部真实事件保留。 |
| AC-003 | Playwright 验证工具卡片跳转 `tool_call`、下一事件进入 `tool_result`、播放/暂停状态正确。 |
| AC-004 | 对比页断言 `off` 4/6、68,087 Token 与 `extractive` 3/6、40,340 Token，6 个任务 checks 可展开。 |
| AC-005 | `test_legacy_events_gain_inferred_call_ids`、`test_recorded_call_id_is_not_overwritten` 与 Loop 事件测试通过。 |
| AC-006 | 路由拦截 `data.json` 后，页面显示“不会用虚构数据”和导出命令。 |
| AC-007 | 62/62 测试、`compileall`、`node --check`、`git diff --check` 通过；浏览器外部请求 0、运行时错误 0、390px 下无横向溢出。 |

## 4. 验证命令

从仓库根目录导出并启动页面：

```bash
python3 scripts/export_dashboard.py   evals/results/m1_2-off-final-20261028.json   evals/results/m1_2-extractive-final-20261028.json   evals/results/m1_2-model-final-20261028.json   --labels off extractive model   --output dashboard/data.json

python3 -m http.server 8766
# 打开 http://127.0.0.1:8766/dashboard/
```

质量门禁：

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall agent providers tools scripts tests
node --check dashboard/app.js
git diff --check
git check-ignore -v dashboard/data.json
```

结果：`Ran 62 tests ... OK`，其余命令均成功；`dashboard/data.json` 命中 `.gitignore`。

Playwright 浏览器验证覆盖：

- 工具卡片 → 真实 Trace 事件；
- 下一事件、播放与暂停；
- A/B 报告交换和 checks 展开；
- 空数据状态；
- 1440px 桌面与 390px 窄屏；
- 外部请求 0、控制台运行时错误 0。

## 5. 计划与实际偏差

- 计划中的三视图全部保留，没有引入 React、CDN、构建链或 Web 后端。
- 第一次直接从仓库根目录运行导出脚本时暴露了 Python 模块导入路径问题；导出 CLI 增加仓库根路径引导，并补了 CLI 回归测试。
- 浏览器 QA 发现对比页 `[run, side]` 解构错误；修复后重新完成 A/B 与交换验证。
- 首次页面加载产生 favicon 404；补内联 favicon 后控制台无错误。
- 没有新增 Live Eval。唯一 Agent Loop 变更是 Trace 字段，不改变模型输入、工具 Schema、审批、上下文或压缩行为。

## 6. 已知限制

- `dashboard/data.json` 是 `local-unredacted`，可能包含真实 final response、工具参数和 observation；字符截断不是脱敏，公开分享前必须另做脱敏方案。
- 三份旧报告的 94 次工具调用均无原始 `call_id`，页面只能标记为确定性推断；新 Trace 才具有记录值。
- 页面是静态快照，不会自动监听新报告；每次评测后需要重新运行导出器。
- 页面显示报告已记录的数据。旧报告没有 prompt/message 全文和代码 revision 时，不伪造或回填。
- 不提供在线调参或执行；在浏览器里改变 A/B 选择只改变查看方式，不会运行 Agent。
- 单次 Live Eval 的 Token、耗时和成功率会受本机模型服务、缓存和运行时状态影响，不能作为稳定 benchmark。

## 7. 失败与负面结果

- 初次直接执行 `python3 scripts/export_dashboard.py` 因 `sys.path` 不含仓库根目录而无法导入 `agent`；已修复并通过子进程 CLI 测试验证。
- 初版对比视图错误解构 `[run, side]`，触发浏览器运行时错误；浏览器 QA 发现后修复并重跑全部交互。
- 初次静态服务器请求 favicon 返回 404；补 data URI favicon 后消失。
- 本轮没有可归因于 Dashboard 的 Agent 行为变化，因此没有新增成功率、成本或压缩收益声明。

## 8. 后续工作

- M2：从整文件覆盖升级到 `apply_patch`，并建立“修改 → 测试/校验 → 修复”的验证闭环。
- 后续可单独规格化受控调参运行；必须设计固定任务、临时 workspace、审批、取消、密钥和进程边界。
- 如需公开演示，必须新建脱敏导出规格，不能直接把本地 `data.json` 发布。

## 9. 完成声明

- [x] 实现与规格一致
- [x] 验收标准有证据
- [x] 测试和静态检查完成
- [x] 安全边界描述准确
- [x] 文档已同步
