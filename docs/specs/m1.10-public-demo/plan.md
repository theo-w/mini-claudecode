# M1.10 Public Learning Demo Implementation Plan

- Spec：`spec.md`
- 状态：In Progress
- 日期：2026-10-29
- 关联 ADR：ADR-004（只读投影）

## 1. 方案摘要

在现有单页 Dashboard 上增加“公开模式”运行状态。页面在 Render 域名或显式 `?demo=public` 时，于数据加载前进入公开模式；只保留 Build 与 Lego 两个无需 `data.json` 的视图，并调整标识与课程 CTA。Render 使用静态发布路径 `dashboard`，因此真实数据文件不会进入构建产物。

该方案不改 Agent runtime，不引入第二套页面或后端，是最小且可验证的公开化路径。

## 2. Constitution Check

| 原则 | 影响 | 结论 |
|---|---|---|
| C-01 证据优先 | 公开和本地模式分别验证，不用合成 Trace 充数 | Pass |
| C-02 最小充分系统 | 复用现有页面，只增加模式判断和少量文案 | Pass |
| C-04 安全边界 | 在 fetch 前短路，静态发布不包含 ignored 数据 | Pass |
| C-07 规格先于实现 | 本规格记录需求、任务和验收证据 | Pass |

## 3. 架构与协议影响

- Agent Loop：无变化。
- 消息协议：无变化。
- 工具 Schema：无变化。
- 上下文：无变化。
- Trace：公开模式不读取；本地模式保持原有只读映射。
- 配置：新增 `render.yaml` 静态站点配置。
- 安全边界：公开模式无模型、工具、文件写入或命令执行通道。

## 4. 文件影响

| 文件 | 计划改动 |
|---|---|
| `dashboard/app.js` | 增加公开模式识别、数据请求短路、导航/标识/CTA 切换 |
| `dashboard/index.html` | 增加可更新的页头标识文本节点 |
| `dashboard/styles.css` | 增加公开模式状态点样式 |
| `render.yaml` | 新增 Render 静态站点配置 |
| `tests/test_public_demo.py` | 增加公开模式与部署配置契约测试 |
| `README.md` | 增加公开 Demo、Render 部署与本地完整模式说明 |
| `docs/ROADMAP.md` | 记录 M1.10 与下一步 |
| `docs/specs/README.md` | 增加 M1.10 规格索引 |
| `main.py` | 版本更新为 v0.12.0 |

## 5. 实施顺序

1. 先增加公开模式与 Render 配置失败测试；
2. 修改 HTML 页头标识为可更新文本；
3. 在 `loadData()` 前判断公开模式并进入 `public` 状态；
4. 调整导航隐藏、课程数据状态与最终 CTA；
5. 增加 Render 静态配置；
6. 运行全量测试与本地双模式浏览器 QA；
7. 推送 GitHub，创建 Render 静态服务并验证线上交互；
8. 将线上 URL 回填简历站。

## 6. 测试策略

### 确定性测试

- 正常路径：Render 域名与查询参数识别为公开模式；
- 安全路径：公开模式在 `fetch("data.json")` 前返回；
- 降级路径：本地 `404` 仍使用既有 missing 状态；
- 部署路径：`render.yaml` publish path 为 `dashboard`；
- 数据卫生：`.gitignore` 继续排除 `dashboard/data.json`。

### 浏览器验收

- 公开模式：1440 × 1000、390 × 844；
- 网络：`data.json` 请求数为 0；
- 交互：Build 可切章，Lego 可跑基线；
- 错误：console error 与 pageerror 均为 0；
- 布局：`scrollWidth <= clientWidth`。
- 本地完整模式：确认七个视图和真实数据入口仍可用。

### Live Eval

不新增 Live Eval。本变更不改变 Agent 行为，不需要模型调用。

## 7. 安全与失败处理

- 高风险工具：无。
- 审批策略：无变化。
- 超时/取消：无变化。
- 回滚方式：移除 `render.yaml` 并恢复页面模式逻辑即可回退。
- 已知限制：自定义域名需要显式 `?demo=public` 才能提前短路；无数据时的 404 降级仍保留。

## 8. ADR 需求

不需要新 ADR。本变更沿用 ADR-004“Dashboard 是只读投影”，只增加公开环境下的视图裁剪。

## 9. 交付与验证

- [x] 规格验收映射完整
- [x] 单元测试与静态检查
- [x] Live Eval 说明不适用
- [x] 文档和部署说明更新
