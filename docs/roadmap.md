# Roadmap — Zotero Scholar Agent

> 状态: 活文档，随阶段推进更新。术语与 `CONTEXT.md` 保持一致：Knowledge Vault、Paper Knowledge Record、Knowledge Surface、Structured Projection、Paper Mention、Semantic Relationship、In-Focus Paper。架构级决策以 `docs/adr/` 为准。

## 1. 产品定位

**面向用户**: 学术研究员，尤其是以阅读、比较、综述论文为日常工作流的人。

**产品目标**: 在 Codex agent 加持下，提炼论文关键价值，沉淀用户的对话记忆与思考，提升研究员的判断力与 taste，最终形成一个持续进化的领域知识框架。

产品形态的三级跃迁:

```text
单篇论文的问答工具
   ↓
跨论文的知识网络
   ↓
领域级的活知识框架
```

判断功能是否值得做的标准:

- 它是否让 Knowledge Vault 里的知识更多、更准或更可用。
- 它是否降低研究者把想法沉淀进 Vault 的交互成本。
- 它是否让 Codex 更稳定地利用已有知识，而不是重复探索。

## 2. 开发原则

### 前端: Research Flow UX

- 高频操作一步可达: 提问、`@` 提及论文、引用选区、查看页码证据、审查 Knowledge 更新。
- 保持 Zotero reader 的密集、稳定、低干扰风格；先打磨真实阅读流，不先做大型 dashboard。
- 所有 agent 行为要可解释: 本轮用了哪些论文、读了哪些文件、写了什么 Semantic Relationship、是否提交到 Vault。
- 审查默认 **post-turn review**: Codex 完成回答和 Vault 写入后，用户查看 diff/关系摘要并可回滚。不要在普通 turn 中改成 pre-commit approval，除非另开架构设计。

### 后端: Codex 编排与 Vault

- turn 编排逻辑逐步从 `src/modules/sidebar.ts` 下沉到 service 层；prompt 构造、context 分层、关系 diff、projection 生成都应可单测。
- 上下文窗口消耗是核心成本指标。执行 Layered Paper Context: 默认注入 Knowledge Surface 或 compact projection，`text.txt`、图表、截图、源码按需读取。
- Vault 中人读优先的是 `memory.md`，机器处理使用 plugin-generated `record.json`。Codex 不直接编辑 `record.json`。
- AGENTS.md 继续承载 Vault 行为规则，但关键 workflow 不应只靠 prompt 字符串散落在 UI 层。
- 外部检索能力优先设计成可替换集成。MCP 是候选方向，但插件第一阶段不应静默修改用户 Codex 配置。

## 3. Phase 2 — 日常阅读主路径优化

目标: 把日常使用路径打磨成稳定闭环:

```text
打开论文 → 建立 Paper Knowledge Record → 提问 → 引用页码证据 → @ 关联论文 → 审查 Knowledge 更新
```

### 2.1 抽出 Research Turn Orchestration

状态: 已完成第一轮抽离。`runResearchTurn()` 已承接 Codex/Vault turn 生命周期，`sidebar.ts` 保留 UI 状态与渲染职责。后续只做增量收口，不在 sidebar 继续堆业务编排。

- 已抽出 turn 编排服务，接收 In-Focus Paper、用户问题、选区引用、Paper Mentions，返回 assistant 内容、usage、activities、memory/relationship 更新结果。
- 已抽出 prompt builder，覆盖无 mention、单 mention、多 mention、Knowledge Write Scope、relationship format。
- 已抽出 activity aggregation 和 relationship diff 纯函数。
- 已实现 resume 失败后 fresh thread 重试一次。

剩余收口:

- 如果后续继续拆 sidebar，优先拆 Memory view 与 message rendering；不要再扩大 `submitQuestion` 职责。

### 2.2 Layered Paper Context 与成本压降

状态: context 管理基础已完成，真实 token/latency benchmark 待做。

- 已实现 Context Window usage display: 基于 Codex JSONL usage 与模型 context window 计算占用。
- 已实现 Hidden Context Digest: 长会话可手动/自动 compact，digest 作为隐藏机器上下文保存。
- 已实现条件化注入: resume 已有 Codex thread 时不注入 digest/recent messages；fresh thread 和 resume fallback 才注入。
- `@` Paper Mention 默认注入 compact Knowledge Surface；全文、图表、截图、源码仍按需读取。
- 下一步需要记录多轮真实使用的 token usage 和 wall-clock，比较 resume / fresh / digest fallback 的成本。

验收:

- 简单问答 input tokens 明显下降，目标是较 Phase 0 约 50k input tokens 减半。
- Codex activity 中不再出现大量无效 Vault 探索步骤。

### 2.3 Paper Knowledge Record 冷启动

冷启动必须是 opt-in 或用户动作触发，不能在首次打开论文时静默跑 Codex。

第一版入口:

- Memory 视图显示 `Build Knowledge Record`。
- 或用户第一次 Ask 时，如果 `memory.md` 仍为空骨架，先执行初始化。
- UI 显示非阻塞、可取消的「正在建立论文档案」状态。

验收:

- 不经用户动作，不发起 Codex turn。
- 初始化结果写入 Knowledge Surface，并生成/刷新 `record.json`。

### 2.4 页码证据与引用 chip

- Codex 回答中的 `[page N]` 可渲染为 chip。
- 点击 chip 跳转到 PDF 对应页。
- Evidence Pointers 与 Semantic Relationship 的 `Evidence:` 字段复用同一页码格式。

验收:

- 从 `text.txt` 页码标记到回答页码 chip 的路径可用。
- 无法定位页码时显示不可跳转状态，而不是静默失败。

### 2.5 Context 管理后续优化

2026-07 已落地 hidden Context Digest、context window 解析、条件化注入与 prompt builder 归位(见 ADR 0004),遗留一件事:

- **digest 质量回归**: digest 的压缩指令与确定性兜底已有单测,但缺少"digest 注入后回答质量不退化"的人工评估清单;至少记录几个长会话样例作为回归用例。

### 2.6 截图与图表理解

- 用户框选/截图保存到 `{itemKey}/figures/` 或等价 derived artifact 目录。
- Codex 可在相关 turn 中读取图像，并把关键结论写入 Evidence Pointers 或 Reader Thinking。
- 图像资产是否进入 git 需要单独决策；默认倾向 derived、可回放、但避免 Vault 历史膨胀。

## 4. Phase 3 — 跨论文知识网络

目标: 让 Paper Knowledge Records 之间的 Semantic Relationships 可见、可审查、可检索。

### 3.1 Relationship Review 与反向链接

- 保持 post-turn review: Codex 写入当前论文 Knowledge Surface，plugin 生成 `record.json`，前端展示新增关系摘要。
- Memory 视图增加「Linked from」反向链接: 扫描其他 `record.json` 找到指向当前论文的关系。
- 增加关系浏览器: 按 relationship type、target paper、source paper 过滤。

验收:

- 打开论文 A 能看到哪些论文链接到 A。
- 新增 Semantic Relationship 在回答下方和 Memory 视图中都可见。

### 3.2 轻量关系图谱

- 优先做插件内 graph view，从 `record.json` 渲染，不把生成的 `graph.html` 提交进 Vault。
- 如果生成静态 HTML，放到 `.generated/` 并 gitignore。
- 第一版只需显示节点、关系类型颜色、点击跳转对应 `memory.md`。

### 3.3 库级问答入口

- 新增库级入口: “基于我读过的论文提问”。
- 无 In-Focus Paper 时，Codex 只读 Vault，默认检索 `*/memory.md` 和 `record.json`。
- 库级 turn 默认不修改任何 paper，除非用户明确触发 library reconciliation。

## 5. Phase 4 — 领域级知识框架

核心思想: 在 per-paper Paper Knowledge Record 之上，引入 per-topic 聚合层。

### 4.1 Topic Note

- Vault 新增 `topics/{topic-slug}.md`，表示一个研究方向的活文档。
- Topic Note 聚合问题定义、方法谱系、论文立场、支持/矛盾关系、开放问题、用户判断。
- 只由用户显式触发生成或更新，例如「把这 5 篇整理成一个 topic」。

### 4.2 Living Survey

- 基于 Topic Note 和关联 Paper Knowledge Records 生成综述草稿。
- 输出建议位置: `topics/{slug}/survey.md`。
- 新论文加入后支持增量更新；git 历史记录理解演化。

### 4.3 谨慎主动性

- 新论文入库后的自动 triage 只能产生建议，不静默写库。
- 用户触发的 review digest 可巡检 Vault，报告知识空洞、过期结论、值得重读的论文。

## 6. 执行顺序

| 顺序 | 内容 | 理由 | 状态 |
| ---- | ---- | ---- | ---- |
| 1 | 文档同步 + ADR | 先固定 Paper Knowledge Record / Structured Projection / post-turn review 方向 | ✅ 完成(ADR 0003/0004,2026-07) |
| 2 | 抽 Research Turn / Prompt Builder 服务 | 降低 `sidebar.ts` 复杂度，后续能力有稳定承载点 | ✅ 第一轮完成 — `runResearchTurn`、prompt/activity/relationship helpers 已抽出 |
| 3 | Layered Paper Context + token/latency 指标 | 直接改善成本和日常体验 | 🔶 部分 — token 指标/context window/digest/条件化注入已落地;真实 benchmark 与 In-Focus compact surface 注入未做 |
| 4 | 页码引用 chip | 提升可信度，成本低 | 🔶 代码完成 — 解析/渲染/跳转与禁用态已实现并单测;Zotero 运行时点验按 `docs/benchmarks/page-evidence-dogfooding.md` 进行中 |
| 5 | post-turn Knowledge Review 增强 + 反向链接 | 让 Semantic Relationships 真正可见、可审查 | 未开始 |
| 6 | opt-in 冷启动 | 改善首问体验，同时守住用户控制和成本边界 | 未开始 |
| 7 | 截图/图表理解 | 增强论文输入质量 | 未开始 |
| 8 | 库级问答 + 关系图谱 | 进入跨论文知识网络 | 未开始 |
| 9 | Topic Note / Living Survey | 需要前面积累足够高质量的 Paper Knowledge Records | 未开始 |

## 7. 进展记录

- **2026-07** 页码证据 chip 落地: `src/services/page-evidence.ts` 纯解析层(`[page N]` → 分段),`src/modules/page-jump.ts` reader 跳页适配(navigate → internalReader → PDFViewerApplication 分级 fallback),sidebar 渲染 chip(跳过 pre/code/a,Knowledge review 块 Evidence 同样 chip 化),不可跳转显示禁用态且点击可自愈重判。dogfooding 清单与 token/latency、digest 质量记录表见 `docs/benchmarks/page-evidence-dogfooding.md`。
- **2026-07** `76d5fbd` Research Turn Orchestration 抽离: `src/services/research-turn/`(orchestrator/prompt/activity/relationships)承接 Codex/Vault turn 生命周期,`sidebar.ts` 回归 UI 职责;条件化上下文注入(resume 不注入 digest/recent);compact 后清空 `codexThreadId`;resume 非超时失败降级 fresh thread 重试一次;`message-format.ts` 中立模块消除分层倒置。61 个单测覆盖。
- **2026-07** `7973850` Codex context 管理落地: hidden Context Digest(70% 提示 / 85% 自动压缩,cheap model → default model → 确定性兜底),`context-window.ts` 从 Codex 配置/catalog 解析模型上下文窗口,per-turn token usage 统计与前端指标,compact 状态条与 digest debug 视图;ADR 0003(Paper Knowledge Record / Structured Projection)、ADR 0004(Hidden Context Digest)。遗留项见 §2.5。
