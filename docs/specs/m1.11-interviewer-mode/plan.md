# M1.11 Interviewer Project Brief Plan

- Spec：`spec.md`
- 状态：Implemented（本地验收完成，等待线上部署复核）
- 日期：2026-10-30
- 关联 ADR：ADR-004（只读投影）

## 1. 方案摘要

在现有静态 Dashboard 内增加一个公开专用的 `brief` 视图，不创建第二套页面，也不复制 Build/Lego 的状态。公开模式在数据加载前设置为 `brief/build/lego` 三视图状态机，本地模式继续使用原有七视图状态机。

首屏用深色项目卡回答“项目是什么、为什么不是 Claude Code、有哪些可验证交付”；其下用三步故事、项目证据卡、四层证据与面试路线逐层展开。主 CTA 复用现有乐高基线函数，次 CTA 复用现有从零建造入口，避免新增执行路径。

选择该方案而不是独立 landing page 的原因：

- 保留单一 DOM、样式与状态源，减少内容漂移；
- 用户可在同一页面从“理解”进入“操作”，不需要跨链接；
- 本地完整模式可以继续隐藏 `brief`，不污染真实 Trace 调试路径；
- 不引入新的部署单元、路由框架或后端。

## 2. Constitution Check

| 原则 | 影响 | 结论 |
|---|---|---|
| C-01 证据优先 | 页面把工程测试、教学效果、Agent 效果和生产安全分层，并明确测试边界 | Pass |
| C-02 最小充分系统 | 复用既有乐高纯函数与静态页面，只增加公开叙事和一个视图状态 | Pass |
| C-04 安全边界 | 公开模式仍零 API、零真实工具、零 Trace，文案区分展示边界与生产安全 | Pass |
| C-07 规格先于实现 | HTML 骨架已先落地，本规格为回溯补齐；入口、测试与验收在完成前收敛 | Pass（有流程偏差，已记录） |
| C-08 小步可逆 | 改动集中在 `dashboard/` 与文档，回滚为撤销本阶段提交 | Pass |
| C-09 数据卫生 | 不读取、生成或提交 `dashboard/data.json` | Pass |
| C-10 文档是交付物 | 补齐 Spec/Plan/Tasks/Implement，并同步 README/ROADMAP/索引 | Pass |

## 3. 架构与协议影响

- Agent Loop：不改变真实 Agent Loop；主 CTA 只重放既有乐高确定性事件。
- 消息协议：不适用，不发出模型请求。
- 工具 Schema：不适用，不新增或执行工具。
- 上下文：不适用，不读取 Trace 数据。
- Trace：不增加真实 Trace 采集或公开；教学事件仍只存在浏览器内存。
- 配置：新增公开模式初始视图 `brief`，不改变模型、Provider 或 Eval 配置。
- 安全边界：公开模式继续在 `fetch("data.json")` 之前短路；无 API Key、Shell、文件写入或网络执行入口。

## 4. 文件影响

| 文件 | 计划改动 |
|---|---|
| `dashboard/index.html` | 增加公开 Brief 标签、项目速览 DOM、两个 CTA |
| `dashboard/app.js` | 增加公开三视图状态机、默认入口、CTA 绑定、可见标签键盘遍历 |
| `dashboard/styles.css` | 增加 Brief Hero、故事、证据卡、执行路线与响应式样式 |
| `tests/test_public_demo.py` | 增加默认入口、公开/本地视图、CTA、证据层与零执行通道契约 |
| `docs/specs/m1.11-interviewer-mode/*` | 新增完整 SDD 链路 |
| `docs/specs/README.md` | 增加 M1.11 索引 |
| `docs/ROADMAP.md` | 记录 M1.11 交付、边界与下一阶段 |
| `README.md` | 更新公开体验说明、版本、测试数与规格链接 |
| `main.py` | 版本更新为 `v0.13.0` |

## 5. 实施顺序

1. 固定公开 Brief 的页面语义、证据分层与两个行动入口。
2. 在 `app.js` 中加入公开 `brief/build/lego` 状态机，并保证本地 `build` 默认入口不变。
3. 完成 Brief 的桌面与手机样式，验证首屏可读和无横向溢出。
4. 先补静态契约测试，再修正入口与 CTA 行为。
5. 运行全量确定性测试、Python 编译、JavaScript 语法和格式检查。
6. 用 Playwright 验证公开桌面/手机、CTA、基线与本地七视图回归。
7. 更新 README、ROADMAP、规格索引与实现记录。
8. 提交并推送；Render 自动部署后复核线上入口与 `/data.json`。

## 6. 测试策略

### 确定性测试

- 正常路径：公开模式默认 `brief`，可见三标签；本地模式默认 `build`，可见七标签。
- 交互路径：主 CTA 切换到 `lego` 并调用 `startLegoBaseline()`；次 CTA 切换到 `build`。
- 边界路径：公开模式非法视图回退 `brief`；本地模式禁止进入 `brief`。
- 数据路径：公开短路发生在 `fetch("data.json")` 之前。
- 内容路径：三步故事、六个证据卡字段、四层证据与安全边界文案存在。
- 安全路径：Brief DOM 不含 `data.json`、`fetch()`、脚本、iframe 或外部执行入口。

### 浏览器验收

- 公开桌面 `1440 × 1000`：默认 Brief；标签为三项；主 CTA 启动基线；无错误和溢出。
- 公开手机 `390 × 844`：同上，按钮全宽可点按，无横向溢出。
- 本地完整模式：七标签可见，Brief 隐藏，默认 Build；逐个切换原七视图无异常。
- 网络：公开模式 `data.json` 请求数为 0；线上 `/data.json` 返回 404。

### Live Eval

不适用。本次不修改 Agent runtime、Prompt、模型、工具或真实 Eval。页面中的 `BLOCKED / UNKNOWN / NONE` 是固定教学模拟输出，必须继续标注为非真实任务结果。

## 7. 安全与失败处理

- 高风险工具：无新增，页面不提供工具执行入口。
- 审批策略：不修改。
- 超时/取消：沿用原有乐高页面定时器；切换视图不会启动真实进程。
- 失败处理：若 Brief CTA 无法启动，保留 Build/Lego 现有直接入口；若公开状态机异常，回退到 `brief`，不请求 Trace。
- 回滚方式：撤销 `dashboard/index.html`、`dashboard/app.js`、`dashboard/styles.css` 和对应测试/文档改动；Render 继续部署 M1.10 版本。
- 已知限制：页面可改善理解路径，但不能证明学习效果、真实 Agent 成功率或生产安全。

## 8. ADR 需求

不需要新增 ADR。本变更复用 ADR-004 的只读投影原则，不改变协议、数据模型、安全边界或部署架构。

## 9. 交付与验证

- [x] 规格验收映射完整
- [x] 单元测试与静态检查
- [x] Live Eval 不适用并记录原因
- [x] 桌面/手机浏览器验收
- [x] 本地七视图回归
- [ ] Render 线上部署复核
- [x] 文档和规格索引更新
