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

状态: context 管理基础已完成，真实 token/latency benchmark 待做；dogfooding 已纠正 `turn.completed.input_tokens` 的累计工作量语义。

- 已实现 per-turn usage display: Codex JSONL `input_tokens`/`cached_input_tokens` 用于成本观测，不再伪装成 active context 占用率。
- 已实现 Hidden Context Digest: 长会话可手动 compact，digest 作为隐藏机器上下文保存。自动阈值 compact 暂停，直到 `codex exec` 提供可信 active/last-context 信号。
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

**前置缺口(2026-07-10 审查发现)**: 真实 Vault 中 `text.txt` 均无 `[page N]` 标记——PDF.js 结构化解析在运行时从未成功(每页 getTextContent 为空,疑似 Xray 边界问题,见 `.logs` 的 `pdf-text-empty-pdfjs`),实际全部走 PDFWorker 兜底。PDFWorker 文本自带 `\f` 分页符且与印刷页码一一对应,应在兜底路径按 `\f` 切分并补 `[page N]` 标记,并对无标记的存量 `text.txt` 做一次性强制刷新;否则 Codex 无页码依据,chip 无法通过验收。

验收:

- 从 `text.txt` 页码标记到回答页码 chip 的路径可用。
- 无法定位页码时显示不可跳转状态，而不是静默失败。

### 2.5 Context 管理后续优化

2026-07 已落地 hidden Context Digest、context window 解析、条件化注入与 prompt builder 归位(见 ADR 0004)。Dogfooding 发现 `turn.completed.input_tokens` 是一轮内多次模型调用的累计输入，不能用来计算 active context 百分比；错误百分比与 70%/85% 自动阈值已移除，遗留两件事:

- **digest 质量回归**: digest 的压缩指令与确定性兜底已有单测,但缺少"digest 注入后回答质量不退化"的人工评估清单;至少记录几个长会话样例作为回归用例。
- **可信 occupancy 信号**: 调研 Codex app-server 的 active/last-context token usage，或等待 `codex exec --json` 暴露等价事件；在此之前只提供手动 Compact。

### 2.6 截图与图表理解

设计基线见 ADR 0005(分层 PDF 解析): PDFWorker 确定性抽取是 `text.txt` 的唯一默认路径,Codex pdf-skill(pdftoppm 渲染 + Python 抽取)只做按需增强。

- 用户框选/截图保存到 `{itemKey}/figures/` 或等价 derived artifact 目录。
- 当问题需要视觉细节时,按需将相关页渲染为 PNG(`pdftoppm`)放入 `{itemKey}/figures/`,用 `codex exec -i` 附图 — 与用户截图互补,不替代。
- 增强路径先探测 poppler/python 可用性,缺失时提示安装;默认阅读路径永不依赖它们。
- Codex 可在相关 turn 中读取图像,并把关键结论写入 Evidence Pointers 或 Reader Thinking。
- 图像资产是否进入 git 需要单独决策;默认倾向: 渲染页可再生、gitignore,用户截图保留(在本节设计时定稿)。

### 2.7 扫描版 PDF 兜底(opt-in Codex 解析)

现状: PDFWorker 对扫描件返回空文本,vault prep 直接抛错,论文完全进不了知识系统。按 ADR 0005:

- 空文本时 UI 提供显式「用 Codex 解析这篇 PDF」入口,opt-in、绝不自动触发。
- Codex 产出的文本经过机械校验(页数与 PDF 一致、`[page N]` 标记齐全且单调)才被接受为 `text.txt`。
- `text.meta.json` 用独立 `parserSource` 值记录来源,保留可追溯性。
- 原始 PDF 不进 Vault;Codex 每次调用按需获得 Zotero storage 只读路径。

验收:

- 扫描件从硬失败变为可引导的解析路径。
- 校验不通过时明确报告失败原因,不写入半成品 `text.txt`。

### 2.8 Vault 远程托管(GitHub)

现状: git 是整个 Vault 级别的单一仓库(`vault.ts::commitVaultChanges`,每 turn 一次 `add -A` + commit),尚未配置 remote。单仓库层级是正确的(跨论文相对链接、一次 clone 整库迁移),保持不变。上传 GitHub 前需要:

- **默认 private 仓库**: `text.txt` 是版权论文全文,`conversations/*.md` 是私人研究思考,公开仓库有法律与隐私风险。文档中写死此默认,公开发布只能走 §7.4 投影路径(经筛选的 Knowledge Surface/Topic Note)。
- **gitignore 加固 + 存量迁移**: 现实 `.gitignore` 只有 `*/code/`,`.logs/` 已被追踪(与 CONTEXT.md 意图不符)。补 `.logs/`、`.generated/`、渲染页 `figures/`(按 ADR 0005 定稿),并对存量做一次性 `git rm --cached` 迁移。
- **同步策略 V1**: 单机单写者假设 + 用户手动/定期 push;插件不自动推送(网络失败与凭证不应阻塞研究 turn)。opt-in 后台自动 push 为后续增强;多机双写 merge 是独立 ADR 级决策,默认不做。
- **提交者身份**: 目前硬编码 `zotero-agent <agent@local>`,托管后考虑读取用户 git 全局配置,保留 agent 标识为 fallback。

验收:

- 新建 Vault 的 `.gitignore` 覆盖全部非知识资产;存量 Vault 迁移后 `git ls-files` 无 `.logs/`。
- 配好 remote 的 Vault 在另一台机器 clone 后,插件可识别并继续使用(与 #9 vault.json 版本标记配合)。

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

原则: **代码交付已领先于真实验证——先用真实使用数据关闭 🔶 项,再开新功能。** 产品灵魂是 `memory.md` 的质量演进,知识质量验收机制先于一切扩展功能。

| 顺序 | 内容 | 理由 | 状态 |
| ---- | ---- | ---- | ---- |
| 1 | 文档同步 + ADR | 先固定 Paper Knowledge Record / Structured Projection / post-turn review 方向 | ✅ 完成(ADR 0003/0004,2026-07) |
| 2 | 抽 Research Turn / Prompt Builder 服务 | 降低 `sidebar.ts` 复杂度，后续能力有稳定承载点 | ✅ 第一轮完成 — `runResearchTurn`、prompt/activity/relationship helpers 已抽出 |
| 3 | **真实使用验证(dogfooding)** | 填满 `docs/benchmarks/page-evidence-dogfooding.md` 三张空表: 页码 chip 9 场景、resume/fresh/digest 三路径 token+latency、digest 质量样例。这是关闭下面两行 🔶 的唯一途径 | 🚧 当前优先级最高 |
| 4 | Layered Paper Context + token/latency 指标 | 机制已落地;等第 3 项实测数据验证「简单问答 input tokens 减半」目标 | 🔶 等 dogfooding 数据关闭 |
| 5 | 页码引用 chip | 代码+单测完成;等第 3 项运行时点验关闭 | 🔶 等 dogfooding 点验关闭 |
| 6 | Knowledge Surface 质量验收机制 | `docs/benchmarks/knowledge-surface-quality.md`: 核心七节完整性、Abstract 忠实度、无 blind-append 膨胀、关系行格式合规(决定 record.json 可解析);从 Codex activity 量化「知识复用率」(读 memory.md 命中 vs 重翻 text.txt) | 🔶 rubric、硬门槛和指标已建立;待 3–5 篇真实论文评分后固化阈值 |
| 7 | opt-in 冷启动(§2.3) | 「沉淀」目标的直接杠杆;无冷启动则 memory.md 只靠问答副作用零散生长。用第 6 项 rubric 验收产出 | 未开始 |
| 8 | post-turn Knowledge Review 增强 + 反向链接(§3.1) | 关系目前「只写不看」;做完后跨论文价值第一次对用户可见。动 Memory view 时顺势从 sidebar.ts 拆出 | 未开始 |
| 9 | Vault schema versioning(根级 `vault.json`) | 任何 Knowledge Surface 结构迁移的前置;沿用 text.meta.json parser-version 先例 | 未开始 — 在大迁移前完成即可 |
| 9b | Vault 远程托管准备(§2.8) | gitignore 加固 + `.logs/` 存量 untrack + private 仓库指引 + 手动 push 流程;与 #9 配对(跨机识别) | 未开始 — 工作量小,可随时插入;上传 GitHub 前必须完成 |
| 10 | 扫描版 PDF 兜底(§2.7,ADR 0005) | 扫描件从硬失败变为可用路径;补齐入库覆盖面 | 未开始 |
| 11 | 截图/图表理解(§2.6,ADR 0005) | 增强论文输入质量;与 §2.7 共享 pdftoppm 渲染与依赖探测基建 | 未开始 |
| 12 | 源码抓取分析(clone → `{itemKey}/code/`,gitignore) | Codex 相对旧 RAG 的最强差异化能力,从 deferred 提升;比图谱更能体现产品独特价值 | 未开始 — 从 CONTEXT.md deferred 提升 |
| 13 | 库级问答 + 关系图谱(§3.2/§3.3) | 进入跨论文知识网络;图谱在记录数量少时价值有限,后置 | 未开始 |
| 14 | Topic Note / Living Survey(Phase 4) | 需要前面积累足够高质量的 Paper Knowledge Records | 未开始 |
| 15 | 论文发现与定时巡检(§7.3) | browser_use/MCP 检索 + 插件调度,产出建议收件箱;受谨慎主动性约束 | 未开始 — 依赖 Topic/主题积累,置于 14 后 |
| 16 | Notion 投影同步(§7.4) | 单向发布 Knowledge Surface/Topic Note/Survey;Vault 保持唯一可信源 | 未开始 — 双向同步需单独 ADR |

## 7. Codex 能力面撬动策略

Codex 不只是一个问答引擎——它自带一整个可扩展的能力面: **skills**(`~/.codex/skills/`,本机已有 pdf/playwright)、**MCP 服务器**(`codex mcp add`,可挂 Notion/arXiv/Semantic Scholar 等)、**browser_use / computer_use**(本机 stable 且启用)、**图像输入**(`codex exec -i`)、**模型路由**(`--model` cheap model,已用于 digest)。产品战略是持续把这些原生能力转化为知识系统的输入和输出通道,而不是自己重造。ADR 0005 的 pdf-skill 分层只是该策略的第一个实例。

### 7.1 接入判据(每个能力接入前必答四问)

1. **价值判据**: 它是否让 Vault 知识更多、更准或更可用(§1 三条标准)?
2. **真相源边界**: Vault 仍是唯一可信源。外部系统(如 Notion)只能是投影/发布目标或建议来源,绝不成为第二真相源。
3. **配置边界**: 不静默修改用户 `~/.codex` 配置(§2 已有原则)。MCP/skill 的启用必须 opt-in,插件负责探测可用性并引导安装。
4. **降级路径**: 能力缺失时默认主路径必须完整可用(参照 ADR 0005 的依赖探测降级)。

### 7.2 能力 → 产品映射

| Codex 原生能力 | 本机验证状态 | 产品用途 | 归属 |
| ---- | ---- | ---- | ---- |
| pdf skill(poppler+python 工作流) | ✅ 已装,已评审 | 扫描件兜底、按需页面渲染 | §2.6/§2.7,ADR 0005 |
| 图像输入 `codex exec -i` | ✅ CLI 支持 | 截图/图表理解 | §2.6 |
| cheap model `--model` | ✅ 已在用 | digest 压缩、轻量 turn | ADR 0004,已落地 |
| shell + git(源码阅读) | ✅ 核心能力 | 论文代码库 clone 与分析 | 执行顺序 12 |
| playwright skill / browser_use | ✅ 已装 / stable 启用 | 论文 landing page、Papers-with-Code、代码 repo 发现;关键论文网络检索 | §7.3 论文发现 |
| MCP 服务器(`codex mcp add`) | ✅ CLI 支持 | arXiv/Semantic Scholar 检索;Notion 投影同步 | §7.3/§7.4 |
| 定时调度 | ❌ Codex 无常驻调度 | 由插件/OS scheduler 触发 `codex exec` 巡检 | §7.3,受 §4.3 约束 |

### 7.3 论文发现与定时巡检(Paper Discovery)

- 用户定义关注方向(可从 Topic Note 或 Vault 高频主题推导),插件定时(或手动)触发一个只读 Codex turn,经 browser_use/MCP 检索新论文。
- 产出进入**建议收件箱**(suggestion inbox): 候选论文 + 与 Vault 已有记录的关联理由。受 §4.3 谨慎主动性约束——只产生建议,不静默写库、不自动下载。
- 用户采纳后走正常入库路径: 加入 Zotero → 建 Paper Directory → 冷启动建档。

### 7.4 Notion 等外部系统联动

- 方向: **单向投影优先**。把 Knowledge Surface / Topic Note / Living Survey 发布到 Notion 供分享与移动端阅读;Vault 保持唯一可信源。
- 实现候选: Notion MCP server,由 Codex 在用户显式触发的「发布」turn 中执行。
- 双向同步(Notion 笔记回流 Vault)是独立的大决策,需要单独 ADR,默认不做。

## 8. 进展记录

- **2026-07-10** Vault 远程托管规划入档(§2.8): 确认 git 为整 Vault 级单仓库(层级正确,保持);发现实际偏差——`.logs/` 被追踪(`.gitignore` 仅 `*/code/`),需加固 + 存量 untrack;托管默认 private 仓库(text.txt 版权/conversations 隐私),V1 单机单写 + 手动 push,多机 merge 留待独立 ADR。执行顺序新增 9b。
- **2026-07-10** Codex 能力面撬动策略入档(§7): 接入判据四问(Vault 价值/真相源边界/配置边界/降级路径),本机验证的能力清单(skills、MCP、browser_use/computer_use stable、图像输入、模型路由)与产品映射,论文发现建议收件箱(§7.3)与 Notion 单向投影(§7.4)进入执行顺序 15/16。ADR 0005 定位为该策略的第一个实例。
- **2026-07-10** Knowledge Surface 质量验收基线建立: 新增 `docs/benchmarks/knowledge-surface-quality.md`,定义 100 分 rubric、硬失败门槛、七节/Abstract/append-bloat/关系格式/grounding 的验收方法,以及基于 Codex activity 的 Knowledge reuse rate(`M-only`/`M→T`/`T-first`/`No-read`)。页码与 context dogfooding 协议扩展为 3–5 篇论文 × fresh/resume/digest 的固定提示词和证据矩阵;真实 Zotero 点击结果仍待人工填写,不以单测替代。
- **2026-07-10** ADR 0005(分层 PDF 解析)落定: PDFWorker 确定性抽取保持 `text.txt` 唯一默认写入路径;Codex pdf-skill(实为 poppler+python prompt 工作流,非内置解析器)定位为 opt-in 增强层——扫描件兜底(§2.7)与图表理解(§2.6)——机械校验 + `parserSource` 溯源 + 依赖探测降级。执行顺序表重排: dogfooding 验证与 Knowledge Surface 质量验收机制前置,源码抓取分析从 deferred 提升。
- **2026-07** 页码证据 chip 落地: `src/services/page-evidence.ts` 纯解析层(`[page N]` → 分段),`src/modules/page-jump.ts` reader 跳页适配(navigate → internalReader → PDFViewerApplication 分级 fallback),sidebar 渲染 chip(跳过 pre/code/a,Knowledge review 块 Evidence 同样 chip 化),不可跳转显示禁用态且点击可自愈重判。dogfooding 清单与 token/latency、digest 质量记录表见 `docs/benchmarks/page-evidence-dogfooding.md`。
- **2026-07** `76d5fbd` Research Turn Orchestration 抽离: `src/services/research-turn/`(orchestrator/prompt/activity/relationships)承接 Codex/Vault turn 生命周期,`sidebar.ts` 回归 UI 职责;条件化上下文注入(resume 不注入 digest/recent);compact 后清空 `codexThreadId`;resume 非超时失败降级 fresh thread 重试一次;`message-format.ts` 中立模块消除分层倒置。61 个单测覆盖。
- **2026-07** `7973850` Codex context 管理落地: hidden Context Digest(cheap model → default model → 确定性兜底),`context-window.ts` 从 Codex 配置/catalog 解析模型窗口元数据,per-turn token usage 统计,manual compact 状态条与 digest debug 视图;ADR 0003(Paper Knowledge Record / Structured Projection)、ADR 0004(Hidden Context Digest)。原 70% 提示 / 85% 自动压缩因误用累计 `input_tokens` 已在 dogfooding 中撤回,遗留项见 §2.5。
