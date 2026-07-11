# UI 评审待办清单（UI Review Backlog）

> 日期：2026-07-11
> 状态：待执行。执行方式：逐项领取 → 实现 → 提交评审（diff/截图）→ 按验收标准复核通过后勾选。
> 评审基线：本地 master 上的 4 个 UI 提交（cold-start effort、语义 token 层、回答优先侧栏、文档），即 Phase 1/2 完成后的状态。
> 关联文档：`docs/plans/ui-preferences-knowledge-status.md`（四阶段交付计划）、ADR 0009（语义 token）、ADR 0010（回答优先侧栏流）。

## 评审结论摘要

基于 2026-07-11 的四张运行截图（设置页、Memory 视图、Chat 亮色、Chat 暗色）：

**已达成**：暗色模式完全成立（`--za-*` token 层生效）；回答优先布局、trust chips、单一 Run details 折叠区符合 ADR 0010；composer 模型标签去重；undo 删除、内联重命名、空状态均已落地；131 单测 + tsc/build 全绿。

**遗留问题**：2 个真 bug（幽灵引用按钮、fnm 临时路径被持久化）、6 类视觉/文案打磨、2 个未开始的计划阶段（Phase 3/4）、1 项渐进重构。全部收录为下表任务。

## 任务清单

状态标记：`[ ]` 待做 · `[~]` 进行中 · `[x]` 已完成并通过复核

### A. Bug 修复（优先）

- [ ] **A1. 修复幽灵引用按钮（quote popup 残留显示）**
  - 现象：❝ 圆钮钉在面板左缘中部，Chat 亮/暗、Memory 视图均可见。
  - 成因：① `src/modules/sidebar.ts` `showQuotePopup`（约 :3159-3177）在选区 rect 退化时把 left 钳到 8px 边距 → 贴左缘；② `switchChatView` 切视图、切会话时不调 `hideQuotePopup`，陈旧 `is-visible` 残留。
  - 修法：rect 宽高皆为 0 或选区已塌缩时直接隐藏而非钳位；视图切换、会话切换、`renderMessages` 时强制隐藏。
  - 验收：Memory 视图永不出现引用按钮；无有效选区时不显示；仅在助手消息内选中文本后紧贴选区出现。

- [ ] **A2. Codex 路径持久化前解析 symlink（fnm 临时路径 bug）**
  - 现象：Auto Detect 写入了 `~/.local/state/fnm_multishells/16389_.../bin/codex`。fnm multishell 目录是 shell 会话级临时 symlink，shell 退出后失效，插件之后找不到 Codex。
  - 修法：`src/services/codex` 的 `testCodexBinary` 在返回/持久化路径前做 realpath 解析，存真实安装路径。写入时机的改动（检测只读、显式应用）留给 Phase 3。
  - 验收：对 fnm/nvm 安装的 codex 做 Auto Detect，持久化的是解析后的真实路径；重启 shell/机器后配置仍有效；resolve 纯函数部分补单测。

### B. 设置页快速修复

- [ ] **B1. 标签与控件成对换行（修复配对断裂）**
  - 现象："Context Window" 标签留在 Model 行右侧、其输入框掉到下一行独占全宽；"Cold Start Thinking" 同样断开。
  - 修法：`preferences.css` + `preferences.xhtml`——每个"标签+控件"为不可拆分原子（对内 `grid-template-columns: max-content 1fr`），对与对之间整体换行；窄窗口退化为标签在上单列堆叠。
  - 验收：任意窗宽下标签与控件相邻；无水平溢出；zh-CN 长标签不截断。

- [ ] **B2. 状态文字去冗余（不复述表单值）**
  - 现象：Codex 区状态文字逐行复述五个字段值，Vault 区复述目录。
  - 修法：`src/modules/preferences.ts`——保存/检测后只显示一行结果（"已保存 ✓" / "检测成功：codex 0.x @ /real/path"）。
  - 备注：Phase 3 会改即时保存并统一状态呈现，若 Phase 3 即将开工可并入。
  - 验收：每区块状态 ≤ 1 行，不复述表单已有值。

### C. 侧栏打磨

- [ ] **C1. Run details：Codex 活动命令人话化**（本组性价比最高）
  - 现象：直接展示 `/bin/zsh -lc "sed -n '120,280p' …/text.txt"` 原始命令；11 个相同 OK 徽章。
  - 修法：新建纯函数（建议 `src/services/research-turn/activity-label.ts`）解析常见模式 → "Read text.txt (lines 120–280)" / "Search text.txt for evaluation keywords" / "Check git status"，未知模式回退截断原文；`turn-details-view.ts` 渲染标签、原始命令进 tooltip；可选折叠连续同类步骤（"Read text.txt ×5"）；纯函数配 vitest（覆盖 sed/rg/cat/ls/git 及未知回退）。
  - 验收：现有 11 步样例渲染为可读标签；hover 可见原始命令；测试通过。

- [ ] **C2. Memory 卡片：markdown 标题层级视觉区分**
  - 现象："Reader Thinking"（章）与 "Questions/Critiques"（节）渲染成几乎相同的粗黑体。
  - 修法：`chat-panel/memory.css`——h2 用 `--za-font-lg` + 下边框或主色左标；h3 13px + `--za-text-secondary`；收紧间距节奏；全部用 token。
  - 验收：一眼可分辨章/节两级；亮暗主题均成立。

- [ ] **C3. Memory 卡片：空章节隐藏或显示占位**
  - 现象：Library Connections / Explicit Citations / Semantic Relationships 等空章节渲染成连续裸标题。
  - 修法：渲染层处理（不改 memory.md——Vault 是 source of truth）：markdown 渲染前用纯函数过滤/标注空节，空节隐藏或显示淡色 "None yet"。实现须对章节名不敏感（"任何空 h2/h3 节"），因 ADR 0011 即将改 memory.md 结构。
  - 验收：空章节无视觉噪音；非空章节渲染不变；纯函数有测试。

- [ ] **C4. Memory 列表：论文标题回查 Zotero 活数据**
  - 现象：三种标题形态并存——干净标题 / "….pdf" 文件名 / "Full Text PDF" 附件通用名（vault 侧陈旧 meta）。
  - 修法：渲染 `listVaultPapers` 结果时按 itemKey 回查 Zotero 活数据覆盖 title/creators/year；查不到退回缓存值并剥 `.pdf` 后缀、替换通用附件名；可选在 cold-start/updatePaperSignals 时回填 vault meta。
  - 验收：列表均显示正规标题；Zotero 中改标题后刷新可见。

- [ ] **C5. 微文案与图标打磨（聚合项，一次 PR）**
  1. 回答中 vault 链接 "2HMS9JJX/memory.md" 暴露 itemKey → 改 "memory.md"，完整路径进 tooltip。
  2. usage 行 "think 391" → "think 391 tok"，与 in/out 单位一致化。
  3. Memory 排序下拉加 "Sort:" 前缀或排序图标。
  4. Memory 刷新按钮改用 `icons.ts` 的 refresh SVG（`sidebar.ts` 约 :528 仍是 "↻" 字符）。
  - 验收：四项截图复核；无新增裸字符/emoji 图标。

### D. 计划阶段（见交付计划文档，含完整变更清单与验收）

- [ ] **D1. Phase 3：设置页信息架构与可靠性改造**
  - 要点：区块重排（Vault → Codex → Translation Services → About）并解释双 AI 路径；高级项收折叠 Advanced；移除手动 Save 改防抖即时保存；修 `AIService.testConnection(service)`（现在 Test 测的是全局默认服务而非编辑中的服务）；切换服务行不丢未保存编辑；Codex 检测只读；文件/目录选择器、API key 显示切换、删除确认。
  - 依赖：B1/B2 若先完成，执行时合并而非重做。完成后补 ADR + 亮暗手动验证。

- [ ] **D2. Phase 4：主列表知识状态列 + 批量构建闭环**（依赖 D1 完成）
  - 要点：`KnowledgeStatusIndex`（initialize/getForItem/refresh/subscribe，启动异步扫 Vault，优先 record.json.quality，附件+父条目双键）；叠加 cold-start 队列状态；ItemTreeManager "Knowledge" 列（同步 dataProvider 只读内存索引，可排序状态权重：无记录/不完整/构建中/完整；SVG 用 currentColor 适配暗色）；**渲染路径零 Vault I/O（硬性验收）**；失效时机：cold-start 完成、turn 落盘、队列变化，另加主窗口聚焦轻量重扫或手动 refresh（覆盖 Zotero 外改 Vault 的场景，计划文档未列，评审补充）；批量菜单只入队缺失/不完整论文、显示 selected/eligible 计数、空闲隐藏 Cancel。
  - 完成后补 ADR（cached-projection 模型）+ 单测（状态分类/队列叠加/批量资格）。

### E. 渐进重构（穿插进行，不阻塞）

- [ ] **E1. 持续拆分 sidebar.ts facade**（现约 3600 行）
  - 剩余内聚块：memory 面板（约 500 行）→ `sidebar/memory-view.ts`；@mention 自动补全 → `sidebar/mention.ts`；context chips → `sidebar/context-chips.ts`；quote popup → `sidebar/quote-popup.ts`（可与 A1 一起做）；`submitQuestion` 编排最后抽 `sidebar/turn-runner.ts`。
  - 规则：每次迁移零行为变化、facade 导出不变、迁移后跑 `npm test` + `npm run build`；新模块 <200 行；`session-controls.ts`(305)、`turn-details-view.ts`(241) 已超标，顺手再拆。

## 建议执行顺序

A1 → A2 → B1 → B2 → C1 → C2/C3/C4/C5 → D1 → D2；E1 穿插。

## 每项任务的通用完成标准

1. `npm test`、`npm run build` 通过；涉及纯逻辑的改动补 vitest 单测。
2. 涉及 UI 的改动在 Zotero 亮/暗两主题下手动验证并截图。
3. 只用 `--za-*` token，不引入组件级硬编码颜色（ADR 0009）。
4. 提交评审：diff + 截图 → 按本文件对应验收标准复核 → 勾选。
