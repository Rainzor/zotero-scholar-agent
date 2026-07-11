# UI 评审待办清单（UI Review Backlog）

> 日期：2026-07-11（原稿），2026-07-11 依据本地 master 实际进度重新核对并更新状态
> 状态：见各项状态标记。执行方式：逐项领取 → 实现 → 提交评审（diff/截图）→ 按验收标准复核通过后勾选。
> 评审基线：本地 master 上 Phase 1/2 完成后的状态（UI token 层、回答优先侧栏）。
> 关联文档：`docs/plans/ui-preferences-knowledge-status.md`（四阶段交付计划）、ADR 0009（语义 token）、ADR 0010（回答优先侧栏流）、ADR 0013（Phase 3 设置页可靠性）。
>
> 说明：此文档此前只存在于基于旧 `origin/master`（落后本地 master 20+ 提交）的分支/PR #18 上，无法直接合并到当前 master。此版本是在当前 master 基础上重新核对每一项实际状态后的重建版，取代那个分支上的版本；旧分支/PR 可以关闭。

## 评审结论摘要

基于 2026-07-11 的运行截图（设置页亮/暗、Memory 视图、Chat）：暗色模式成立；回答优先布局、trust chips、单一 Run details 折叠区符合 ADR 0010；composer 模型标签去重；undo 删除、内联重命名、空状态均已落地。A2、D1（Phase 3）已在本地完成并通过 145 个 vitest + tsc/build 验证；A1、B2 在核对中确认已随其他改动一并解决。B1、C1–C5 已完成并经用户 Zotero 运行时验收；当前完整测试为 155 个 Vitest 用例，通过生产构建。

## 任务清单

状态标记：`[ ]` 待做 · `[~]` 进行中/待人工复核 · `[x]` 已完成并通过复核

### A. Bug 修复（优先）

- [x] **A1. 修复幽灵引用按钮（quote popup 残留显示）**
  - 现象：❝ 圆钮钉在面板左缘中部，Chat 亮/暗、Memory 视图均可见。
  - 状态：已解决。`switchChatView`（视图切换）与 `renderMessages`（会话切换/重渲染）均已调用 `hideQuotePopup`；`getAssistantSelection` 在选区 rect 完全退化（宽高皆 0）时直接返回 `null`，触发隐藏而非钳位定位。
  - 遗留：未在真实 Zotero 里逐一点击复现验收标准里的三种场景（Memory 视图/无选区/选中文本后紧贴），建议下次打开侧栏时顺手确认一次。

- [x] **A2. Codex 路径持久化前解析 symlink（fnm 临时路径 bug）**
  - 现象：Auto Detect 写入了 `~/.local/state/fnm_multishells/<pid>_.../bin/codex`，shell 会话级临时路径，退出后失效。
  - 状态：已解决，且比原计划更完整。`src/services/codex/path.ts` 新增 `detectCodexBinary()`（绕开已配置路径重新扫描，解决"检测按钮只会重复确认同一个坏值"的问题）与 `findByAutoDetection()`；命中的路径用 `nsIFile.normalize()` 解析 symlink 得到稳定真实路径。另外修了 `resolveViaLoginShell()` 缺少 `-i` 导致不加载 `.zshrc`（fnm/nvm 的 PATH 设置通常在这里）、以及 `extractCodexPath()` 正则把 `codex.js` 误截成 `codex` 的问题。实机验证：从 fnm 环境重新 Detect，成功持久化并跑通一次真实会话。
  - 测试：`test/codex-path.test.ts`（6 个用例，覆盖 `.js`/`.mjs`/`.cjs`/终端粘贴场景）。

### B. 设置页快速修复

- [x] **B1. 标签与控件成对换行（修复配对断裂）**
  - 现象：窄窗口下"Context Window"标签留在 Model 行右侧、其输入框掉到下一行独占全宽；"Cold Start Thinking"同样断开。
  - 状态：已完成并运行时复核。Advanced 中每组标签+控件已成为独立 grid field；中等宽度整体换行，窄宽度退化为标签在上、控件在下的单列布局。
  - 验收：亮/暗主题、窄宽和 zh-CN 长标签均已确认无配对断裂或水平溢出。

- [x] **B2. 状态文字去冗余（不复述表单值）**
  - 状态：随 Phase 3 一并解决。所有区块统一为单行状态（`idle/saving/saved/error`），不再逐行复述表单字段值。

### C. 侧栏打磨（本轮已完成并复核）

- [x] **C1. Run details：Codex 活动命令人话化**（本组性价比最高）
  - 现象：直接展示 `/bin/zsh -lc "sed -n '120,280p' …/text.txt"` 原始命令；11 个相同 OK 徽章，看不出在做什么。
  - 修法：新建纯函数（建议 `src/services/research-turn/activity-label.ts`）解析常见模式 → "Read text.txt (lines 120–280)" / "Search text.txt for evaluation keywords" / "Check git status"，未知模式回退截断原文；`turn-details-view.ts` 渲染标签、原始命令进 tooltip；可选折叠连续同类步骤（"Read text.txt ×5"）；纯函数配 vitest（覆盖 sed/rg/cat/ls/git 及未知回退）。
  - 验收：11 步样例渲染为可读标签；hover 可见原始命令；`sed`/`rg`/`cat`/`ls`/`git`/未知回退均有 Vitest 覆盖。

- [x] **C2. Memory 卡片：markdown 标题层级视觉区分**
  - 现象："Reader Thinking"（章）与 "Questions/Critiques"（节）渲染成几乎相同的粗黑体，分不出层级。
  - 修法：`chat-panel/memory.css`——h2 用 `--za-font-lg` + 下边框或主色左标；h3 13px + `--za-text-secondary`；收紧间距节奏；全部用 token。
  - 验收：章/节两级可辨，亮暗主题已复核；所有新增视觉值使用语义 token。

- [x] **C3. Memory 卡片：空章节隐藏或显示占位**
  - 现象：Library Connections / Explicit Citations / Semantic Relationships 等空章节渲染成连续裸标题，一片空白。
  - 修法：渲染层处理（不改 memory.md——Vault 是 source of truth）：markdown 渲染前用纯函数过滤/标注空节，空节隐藏或显示淡色 "None yet"。实现须对章节名不敏感（"任何空 h2/h3 节"），因 ADR 0011 即将改 memory.md 结构。
  - 验收：任意空 h2/h3 无视觉噪音；非空章节和 fenced code 保持不变；纯函数有测试。

- [x] **C4. Memory 列表：论文标题回查 Zotero 活数据**
  - 现象：三种标题形态并存——干净标题 / "….pdf" 文件名 / "Full Text PDF" 附件通用名（vault 侧陈旧 meta）。
  - 修法：渲染 `listVaultPapers` 结果时按 itemKey 回查 Zotero 活数据覆盖 title/creators/year；查不到退回缓存值并剥 `.pdf` 后缀、替换通用附件名；可选在 cold-start/updatePaperSignals 时回填 vault meta。
  - 验收：列表显示 Zotero 实时标题；改标题后刷新可见；删除/缺失条目回退时不显示通用附件名或 `.pdf` 后缀。

- [x] **C5. 微文案与图标打磨（聚合项，一次 PR）**
  1. 回答中 vault 链接 "2HMS9JJX/memory.md" 暴露 itemKey → 改 "memory.md"，完整路径进 tooltip。
  2. usage 行 "think 391" → "think 391 tok"，与 in/out 单位一致化。
  3. Memory 排序下拉加 "Sort:" 前缀或排序图标。
  4. Memory 刷新按钮改用 `icons.ts` 的 refresh SVG（`sidebar.ts` 约 :528 仍是 "↻" 字符）。
  - 验收：四项已截图复核；无新增裸字符/emoji 图标。Vault 链接继续保留完整路径 tooltip，且 Markdown 文本转义有回归测试。

### D. 计划阶段

- [x] **D1. Phase 3：设置页信息架构与可靠性改造**
  - 已完成：区块重排（Vault → Codex → Translation Services → About）+ 双 AI 路径说明文案；Codex 高级项（Model/Context Window/Cheap Model/Cold Start Effort）收进折叠 Advanced；移除全部手动 Save 按钮，改为防抖即时保存 + 统一单行状态；新增 `AIService.testConnection(config)`，Test 按钮改用表单实时值而非全局默认服务；服务切换不丢编辑（防抖持久化，结构性保证，非靠人工确认）；Codex 检测拆成只读 Detect（发现即入框，走与手输入相同的防抖保存）与 Test（纯校验，永不写盘）；新增 Codex/Vault 的原生文件/目录选择器（`ztoolkit.FilePicker`）；API Key 显示/隐藏切换；服务删除改为面板内二次确认（仿 Phase 2 会话删除确认的交互）。
  - 落地位置：`src/modules/preferences/` 拆分自原 516 行的 `preferences.ts`；`docs/adr/0013-preferences-reliability-and-io.md`。
  - 复核：145 个 vitest + tsc + build 通过；亮/暗主题、Codex Detect/Test/fnm 修复均已在真实 Zotero 里截图验证。Remove 二次确认与 Test 命中当前编辑两项未逐一手动点击复核，用户判断代码层保证已足够，暂不强求。

- [ ] **D2. Phase 4：主列表知识状态列 + 批量构建闭环**（依赖 D1，未开始）
  - 要点：`KnowledgeStatusIndex`（`initialize`/`getForItem`/`refresh`/`subscribe`，启动异步扫 Vault，优先读 `record.json.quality`，附件+父条目双键索引）；叠加 Cold Start 队列状态（pending/running 显示排队/构建中，失败/取消回退到持久状态、详情进 tooltip）；ItemTreeManager 新增 `Knowledge` 列（同步 dataProvider 只读内存索引，可排序状态权重：无记录/不完整/构建中/完整；SVG 用 currentColor 适配暗色，默认可见）；**渲染路径零 Vault I/O 是硬性验收**；失效时机覆盖 cold-start 完成、turn 落盘、队列变化；批量菜单只入队缺失/不完整论文、显示 selected/eligible 计数、空闲时隐藏 Cancel。
  - 完成后补 ADR（cached-projection 模型）+ 单测（状态分类/队列叠加/批量资格）。
  - 范围较大，建议开工前单独走一轮 Plan（类似 D1/Phase 3 的规划方式）。

### E. 渐进重构（穿插进行，不阻塞）

- [~] **E1. 持续拆分 sidebar.ts facade**（现约 3600 行，未变动）
  - Phase 3 期间新增了 `src/modules/preferences/` 这个同构的"facade + 子模块"拆分案例（8 个子文件，均 <200 行），可作为后续拆 `sidebar.ts` 时的参照，但 `sidebar.ts` 本身尚未拆。

## 建议执行优先级

（A1/A2/B1/B2/C1–C5/D1 已完成，不在下列排序中）

1. **D2（Phase 4）** — 范围明显大于以上任何一项（新模块 `KnowledgeStatusIndex`、ItemTreeManager 列、批量菜单联动），且有"渲染路径零 I/O"这条硬性架构约束，建议先单独走一轮 Plan（同 D1/Phase 3 的规划方式）再动手。
2. **E1** — 没有独立排期价值（不直接改善用户可见行为），仅在后续改动恰好触及 `sidebar.ts` 的内聚区域时机会性拆分，不要为了拆而单独开一轮工作。

## 每项任务的通用完成标准

1. `npm test`、`npm run build` 通过；涉及纯逻辑的改动补 vitest 单测。
2. 涉及 UI 的改动在 Zotero 亮/暗两主题下手动验证并截图。
3. 只用 `--za-*` token，不引入组件级硬编码颜色（ADR 0009）。
4. 提交评审：diff + 截图 → 按本文件对应验收标准复核 → 勾选。
