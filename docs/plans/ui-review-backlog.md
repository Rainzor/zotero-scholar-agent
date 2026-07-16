# UI 评审待办清单（UI Review Backlog）

> Track: both（G1 是研究轮次编排的后端缺口；D2/F2 各带一小块支撑用的后端读取逻辑；其余是前端，见对应条目说明）
> 日期：2026-07-11（原稿），2026-07-11 依据本地 master 实际进度重新核对并更新状态，
> 2026-07-13 新增 F 节（Memory 视图信息架构，用户实测发现），
> 2026-07-13 新增 G 节并重开 A1（真实 dogfooding 发现 cold-start 缺口与幽灵引用按钮回归）
> 状态：见各项状态标记。执行方式：逐项领取 → 实现 → 提交评审（diff/截图）→ 按验收标准复核通过后勾选。
> 评审基线：本地 master 上 Phase 1/2 完成后的状态（UI token 层、回答优先侧栏）。
> 关联文档：`docs/plans/ui-preferences-knowledge-status.md`（四阶段交付计划）、ADR 0009（语义 token）、ADR 0010（回答优先侧栏流）、ADR 0013（Phase 3 设置页可靠性）。
>
> 说明：此文档此前只存在于基于旧 `origin/master`（落后本地 master 20+ 提交）的分支/PR #18 上，无法直接合并到当前 master。此版本是在当前 master 基础上重新核对每一项实际状态后的重建版，取代那个分支上的版本；旧分支/PR 可以关闭。

## 评审结论摘要

基于 2026-07-11 的运行截图（设置页亮/暗、Memory 视图、Chat）：暗色模式成立；回答优先布局、trust chips、单一 Run details 折叠区符合 ADR 0010；composer 模型标签去重；undo 删除、内联重命名、空状态均已落地。A2、D1（Phase 3）已在本地完成并通过 145 个 vitest + tsc/build 验证；B2 在核对中确认已随其他改动一并解决。B1、C1–C5 已完成并经用户 Zotero 运行时验收；当前完整测试为 155 个 Vitest 用例，通过生产构建。**2026-07-13 补充**：A1 此前标记"已解决"，但用户在真实 Zotero dogfooding 时复现（两次无选区仍出现该图标），已重新打开；同一轮还发现一个 cold-start 编排缺口（G1）和两个 Memory 视图信息架构问题（F1/F2）。

## 任务清单

状态标记：`[ ]` 待做 · `[~]` 进行中/待人工复核 · `[x]` 已完成并通过复核

### A. Bug 修复（优先）

- [x] **A1. 修复幽灵引用按钮（quote popup 残留显示）** — 四轮修复均未完全根治，2026-07-14 按用户决定直接砍掉此功能
  - 现象：❝ 圆钮钉在面板左缘中部，Chat 亮/暗、Memory 视图均可见。
  - 状态：之前标记已解决（`switchChatView`/`renderMessages` 调用 `hideQuotePopup`；`getAssistantSelection` 在选区退化时返回 `null`）。**2026-07-13 用户在真实 Zotero 里复现验收标准里"未在真实环境逐一点击确认"这条遗留项时，该图标在两次连续截图中都出现，且用户确认发送提问前两次都没有选中任何 PDF/聊天文字**——按当时的修复逻辑，无选区应该直接触发隐藏，说明这条修复未能覆盖当前触发路径，是回归而不是未验证。
  - 待办：重新定位触发条件（不是"选区退化"这条已修的分支），确认是否有新的调用路径没有接上 `hideQuotePopup`（例如 Build Knowledge Record 完成后的重渲染、或 Memory→Chat 切换时序）。
  - **2026-07-13 第一次修复**（commit `cfe3389`）：补齐了 `renderMemoryBrowse`/`updateStreamingMessage` 的 `hideQuotePopup` 调用，收紧了退化选区判定。**2026-07-14 用户复现：仍未解决**，且这次图标位置跟着回答文字走（不再固定在左边缘），说明是另一个根因。
  - **2026-07-14 二次排查确认真正根因**：`hideQuotePopup` 一直只切换弹窗的 CSS class，**从未清除浏览器真实的 `window.getSelection()`**。流式更新（每个分片 `innerHTML =` 整体替换）和最终渲染（`replaceChildren` 重建 + 给 `[page N]` 引用拆文本节点插入 chip）反复销毁重建回答气泡里的文本节点，此时如果之前恰好存在一个未被清除的选区（哪怕无关紧要、非用户主动拖拽产生的），Gecko 不会清空它，而是把它"重新定位"到新长出来的文本节点上——这个重新定位后的选区是真实、非退化的，能通过我们的过滤阈值，下一次面板内任意鼠标/键盘事件（打字、按回车）一触发就会在这个位置弹出气泡。跟阈值毫无关系，调阈值只是在治标。
  - **2026-07-14 修复已提交**（commit `e579deb`）：新增 `hideQuotePopupAndClearSelection`，在四个会重建 DOM 的调用点（`switchChatView`/`renderMemoryBrowse`/`updateStreamingMessage`/`renderMessages`）额外调用 `window.getSelection()?.removeAllRanges()`；滚动/点击面板外这两个"仅隐藏弹窗、不代表选区已失效"的调用点保持不变，避免误清用户仍在阅读时的合法选区。`npm test`（264 用例）+ `npm run build` 通过。**尚待人工在真实 Zotero 里确认图标不再出现。**
  - **2026-07-14 第三次复现，重新排查（不沿用前两次的诊断）**：用户在只是翻看历史消息（没有主动选中文字）时又看到图标叠在旧回答文字中间。让 agent 彻底重查后确认：弹窗**只有一条**展示路径——`updateQuotePopupFromSelection` 检测到"真实、非退化"的选区就会显示，不存在残留 DOM 节点或重复弹窗元素这类问题；也排查了 Xray/权限边界（结论：这个面板是直接挂在 Zotero 主 chrome 文档下的普通 HTML 节点，不存在跨边界的 Selection 对象不一致）。**真正机制**：用户翻阅长对话时一次不经意的拖动（哪怕只是拖动滚动条、或读到某处顺手拖了一下）会产生一个真实、非退化的选区，弹窗随之显示；之后滚动只调用了 `hideQuotePopup`（只隐藏 UI），**没有清掉这个真实选区**；而 `mouseup`/`keyup` 监听是挂在整个 Zotero 主窗口的 document 级别（捕获阶段），不限于本面板，所以之后任意一次无关的鼠标/键盘事件（发新消息、按回车等）都会重新检查到这个还活着的选区，在它现在滚动到的新位置重新弹出——正好对应"图标位置跟着文字内容、在已经翻页很久之后还冒出来"这个现象。
  - **2026-07-14 第三次修复已提交**（commit `196b9f3`）：把 `messages` 的 `scroll` 事件处理也从 `hideQuotePopup` 换成 `hideQuotePopupAndClearSelection`——这是"仅隐藏不清选区"里唯一真正有风险的一处（滚动本身不会被浏览器原生行为清空选区，不像普通左键点击那样）。保留"点击面板外"不清选区的原有决定（普通左键点击本身就会原生清空选区，若在此处也强制清空可能会打断"右键复制选中文字"这个合法操作，右键菜单弹出前我们的 `pointerdown` 处理器不该抢先清空选区）。`npm test`（264）+ `npm run build` 通过。**残留观察点**：`mouseup`/`keyup` 监听挂在整个 Zotero 窗口而非仅本面板，理论上仍有"別处触发、命中本面板旧选区"的窄窗口；如果这次修复后还复现，下一步应该收窄这两个监听器的绑定范围，而不是继续在清除时机上做文章。
  - **2026-07-14 用户提出兜底方案**：理想行为是"引用后弹窗自动消失，纯粹只是标记上下文"；如果这次还修不好，直接取消这个自动检测选区弹窗的功能，改成用户手动复制粘贴文本到聊天框来实现引用。用户同意再给一次机会，按上一条"残留观察点"里已经定位好的方向修。
  - **2026-07-14 第四次修复已提交**（commit `e08d627`）：把 `mouseup`/`keyup` 监听器从挂在整个 Zotero 主窗口（`doc.addEventListener(..., true)`）收窄到只挂在本聊天面板（`body.addEventListener(..., true)`），这样"点击图书馆列表里别的条目""在别的输入框打字"这类跟本面板无关的操作不会再重新触发选区检查；顺带去掉了变得冗余的 `messages` 级 bubble-phase 监听（`body` 的 capture 监听已经覆盖它）。`npm test`（264）+ `npm run build` 通过。**这是排查报告里唯一一个"确定还没试过"的方向，如果这次仍然复现，说明问题出在完全不同的机制上，按用户的兜底方案，下一步应该直接砍掉这个自动检测选区弹窗功能，改成手动复制粘贴引用。**
  - **2026-07-14 最终决定：直接砍掉此功能**（commit `86dded6`）。用户没有再等第四次修复的复核结果，直接选择兜底方案。移除范围：悬浮引用按钮本身及其 CSS、选区检测的全部机制（`getAssistantSelection`/`findAssistantBubbleFromNode`/`showQuotePopup`/`hideQuotePopup`/`hideQuotePopupAndClearSelection`/`updateQuotePopupFromSelection`/`quoteSelectedAssistantText`/`bindAssistantSelectionEvents`）、专用的 `quote` 图标、composer 里已经变成死代码的"response"类型 context chip（`createContextChip`/`syncContextChips` 收敛回只处理 text-context）、以及 `addon.data.chat.responseQuote` 这个状态字段在 sidebar.ts 里的读写点。**特意保留**：`RESPONSE_QUOTE_PREFIX` 常量、`parseUserContent` 对它的解析、历史消息渲染里的"response"卡片——已保存的旧对话可能已经带着这个标记，保留这部分是为了这些历史记录还能正常显示，不是漏删。`ChatSubmission`/`ResearchTurnRequest.responseQuote` 字段及 `chat-actions`/`research-turn/prompt.ts` 里的相关管线也保留不动——那是 ADR 0015 里"`/note` 命令内容可以 fallback 到一段引用回复"这个更通用、仍在文档里的设计，不是这个悬浮弹窗专属的代码，现在只是永远收到空字符串，无害。`npm test`（264）+ `npm run build` 通过。用户体验从此改为：手动复制粘贴文本到聊天框来引用。

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

### F. Memory 视图信息架构（2026-07-13 新发现）

- [~] **F1. Value-type 标签语义不明，且与 Zotero 镜像标签视觉混淆**
  - 现象：Memory 视图 CURRENT PAPER 区域，`Method`/`Insight`/`Methodology`/`Canon` 四个可切换分类按钮（`src/modules/sidebar.ts:1165-1184`，`valueTypeLabel` 于 `sidebar.ts:1201-1206`）与 Zotero 标签镜像 chip（如截图里的 `WorldModel`，`sidebar.ts:1192-1197`）渲染成同款 pill，肉眼分不清哪个是本插件可编辑的分类、哪个是只读镜像；`Method` 与 `Methodology` 命名本身也容易混淆。唯一的提示是 `button.title = "Toggle value type: method-advance"`（`sidebar.ts:1174`），只是把内部 slug 抄了一遍，没有解释语义。
  - 修法：(a) 把 `button.title` 换成人话解释，文案直接取自 `docs/memory-philosophy.md` P2 的定义（`method-advance`=论文本身推进了某个方法/技术；`transferable-insight`=价值在于一个可迁移的洞见，不一定是方法本身；`methodology`=论文代表某种方法论/流派，理解它有助于理解该方法论；`canon`=领域奠基性文献，定义了术语或范式），不需要新造概念；(b) 给 value-type 按钮和 `zoteroTag`/collection chip 两组元素在视觉上做出区分（如边框粗细、图标或底色语义变体），沿用 `--za-*` token 体系，不新增组件级硬编码颜色。
  - 验收：hover 四个按钮能看到人话解释而非 slug；亮暗主题下能一眼分辨"可点击分类按钮"与"只读镜像 chip"两类元素；不违反 ADR 0009 的 token 规则。
  - **2026-07-13 实拍确认**：真实 Vault 里出现 Rating 显示 "Unrated" 文字，同一行 `notion` 标签后面又有一个绿底 `★★★★★` chip，看起来像"这篇论文被打了5星"。查代码 `sidebar.ts:1149` 确认星号字符在侧栏里只有 Rating 组件这一处用法，且和 "Unrated" 文字共享同一个 span（互斥展示，不可能同时出现两处）——所以那个星星 chip 必然是一条内容恰好是星号的 Zotero 镜像标签，与插件自己的 Rating 无关。这是本条问题目前最直接的实拍证据，优先级可以提前。
  - **2026-07-13 修复已提交**（commit `f44c56e`）：`button.title` 换成人话解释（取自 memory-philosophy.md）；只读 chip（collection/tag）改为 `--za-radius-pill` 圆角 + `cursor: default`，与保持方形 `--za-radius-sm` 的可点击按钮形成形状区分（比单靠颜色更稳健的视觉信号）。`valueTypeLabel`/`valueTypeDescription` 从 `sidebar.ts`（无法被 vitest 引入）挪到 `knowledge-surface.ts`，新增单测覆盖。`npm test`（263 用例）+ `npm run build` 通过。**尚待人工在真实 Zotero 亮/暗主题下确认 hover 文案与形状区分效果。**

- [~] **F2. Memory 视图论文选择列表在论文数量增多后不可用**
  - 现象：`renderMemoryBrowse`（`sidebar.ts:679`）里 Topic/跨论文勾选列表只有 `Sort: Title`/`Sort: Rating` 两种排序（`sidebar.ts:596-599`），没有分组；顶部搜索框（`scheduleMemorySearch`/`runMemorySearch`，`sidebar.ts:1478` 起）其实是全文内容检索，一旦输入就整体替换视图，会连带丢失正在勾选的 Topic 复选框状态。随着 Vault 论文数逼近 30 篇北极星规模，这个列表只能死滚，挑选 Topic 成员会变困难。
  - 修法：区分"内容搜索"与"列表过滤"两种诉求——为 Topic 选择场景单独加一个按标题/作者的即时本地过滤（不发起 Vault 检索、不清空已勾选项），排序下拉增加按 tier/value-type 分组；已勾选数量在滚动时保持可见（sticky 计数）。
  - 验收：Topic 选择模式下输入标题关键字，列表实时过滤且已勾选项不丢失；30+ 篇论文场景下可通过 tier/rating 排序或分组快速定位目标论文；过滤/勾选状态保持的纯逻辑部分有单元测试覆盖。
  - **2026-07-15 修复已实现（本地，未提交）**：连同 F2 一起做了 Memory 视图的完整 master/detail 重构（用户确认三项方向）——(1) 浏览视图改为紧凑导航列表（`memory-navigator.ts`），当前论文只占一行、完整记录仅在点进详情后渲染，消除"内容倾泻在列表之上"和当前论文双重渲染；(2) 常驻 Topic 表单换成显式选择模式（`topic-selection.ts` 的 `TopicSelectionController` + "+ New topic" 按钮 + sticky 选择条，复选框仅在选择模式出现，标题输入与计数随选择条常驻不随重渲染丢失）；(3) 工具栏输入框改为**即时本地过滤**（`memory-filter.ts`，走缓存不读盘、不清空勾选），全文 Vault 检索移到搜索图标切换出的独立搜索行/视图（`memory-view-state.ts` 纯 reducer 管两者互斥）。新增单测：`topic-selection.test.ts`、`memory-filter.test.ts`、`memory-view-state.test.ts`；`npm test`（284 用例）+ `npm run build` 通过。保留了 `.zoteroagent-topic-create`/`.zoteroagent-topic-title` 类名使 `setGenerating` 守卫不变，全部沿用 `--za-*` token。**尚待人工在真实 Zotero 亮/暗主题下验收，并提交。**

### G. Cold Start 与研究轮次编排（2026-07-13 新发现，track: backend）

- [~] **G1. 空记录上直接提问会让 Codex 现场吐原始 JSON，而不是先建档**
  - 现象：在一篇 `tier: L1`、内容区尚未填写的论文上直接问"介绍这篇论文的算法流程"（没有先点 Memory 面板的 "Build Knowledge Record"），Codex 的可见回答里混入了一段 `TL;DR`/`Method.algorithm_flow`（`step`/`name`/`description`/`details`/`evidence`）结构的原始 JSON，而不是一段可读的中文说明。点了 "Build Knowledge Record" 之后重新问同一个问题，回答立刻变成正常的中文分段说明+公式+`p.4` 页码 chip，证明问题只出现在"记录为空时直接问"这一条路径上。
  - 根因：`docs/roadmap.md` §2.3 写的是两条冷启动入口——① Memory 面板的 Build 按钮，② "当用户问第一个问题时如果 `memory.md` 仍是空骨架，先初始化"。搜了 `src/services/research-turn/orchestrator.ts` 和 `sidebar.ts`，**第②条从未被实现**，只有按钮这一条路径存在。所以当用户跳过按钮直接提问时，插件把问题原样交给 Codex，Codex 在一个空 L1 骨架上现场发挥、把内部草稿当成了可见回答。这不是 Codex 随机抽风，是一个 roadmap 写了但代码没做的功能缺口，藏在已经标 ✅ 的 M1-1 里。
  - 修法（任选其一，需要产品决定）：(a) 按 roadmap 原意实现自动初始化——检测到 `memory.md` 仍是空骨架时，先静默跑一次 Build（带"Building paper record"提示），再回答用户的问题；(b) 更保守的做法：检测到空骨架时不要把问题直接转给 Codex，先返回一条本地提示"这篇论文还没有知识记录，请先点 Build Knowledge Record"，把决定权交回用户。两种都比现状（不提示、直接让 Codex 自由发挥）好。
  - 验收：在任意全新论文（`memory.md` 为空骨架）上直接提问，不会再看到原始 JSON/结构化草稿；`docs/roadmap.md` §2.3 的两条入口描述与实际行为一致（如选方案 b，需要同步改文档，去掉"自动初始化"的措辞）。
  - **2026-07-13 修复已提交**（commit `ef87c79`，采用方案 a）：`research-turn/orchestrator.ts` 在读到 `memoryBefore` 后，若检测到内容带插件 block 但核心章节仍是空骨架（复用 `knowledge-quality.ts` 新增的 `isUnbuiltSkeleton`，与 Build/Repair 按钮共享同一判定阈值），会先静默跑一次 `runPaperColdStart`（带 "Building paper record before answering..." 状态提示），再继续原本的提问；冷启动失败时记日志但不阻断提问。新增单测覆盖：`isUnbuiltSkeleton`（`knowledge-quality.test.ts`）与三个编排场景（触发/不触发/失败兜底，`research-turn-orchestrator.test.ts`），`npm test`（261 用例）+ `npm run build` 通过。**尚待人工在真实 Zotero 里用一篇全新论文复现验收标准确认。**

## 建议执行优先级

（A1/A2/B1/B2/C1–C5/D1/G1/F1 已完成，不在下列排序中；A1 最终是移除功能而非修复，见对应条目）

1. **D2（Phase 4）** — 范围明显大于以上任何一项（新模块 `KnowledgeStatusIndex`、ItemTreeManager 列、批量菜单联动），且有"渲染路径零 I/O"这条硬性架构约束，建议先单独走一轮 Plan（同 D1/Phase 3 的规划方式）再动手。
2. **F2** — 现阶段论文数尚少（未到30篇北极星），紧迫性低于 D2，但应在 M1.5 之后的 30 篇回填开始变密集之前落地，避免回填过程中先经历一遍"列表不可用"的体验。
3. **E1** — 没有独立排期价值（不直接改善用户可见行为），仅在后续改动恰好触及 `sidebar.ts` 的内聚区域时机会性拆分，不要为了拆而单独开一轮工作。

## 每项任务的通用完成标准

1. `npm test`、`npm run build` 通过；涉及纯逻辑的改动补 vitest 单测。
2. 涉及 UI 的改动在 Zotero 亮/暗两主题下手动验证并截图。
3. 只用 `--za-*` token，不引入组件级硬编码颜色（ADR 0009）。
4. 提交评审：diff + 截图 → 按本文件对应验收标准复核 → 勾选。
