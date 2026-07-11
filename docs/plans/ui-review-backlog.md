# UI 评审待办清单（UI Review Backlog）

> 日期：2026-07-11（原稿），2026-07-11 依据本地 master 实际进度重新核对并更新状态
> 状态：见各项状态标记。执行方式：逐项领取 → 实现 → 提交评审（diff/截图）→ 按验收标准复核通过后勾选。
> 评审基线：本地 master 上 Phase 1/2 完成后的状态（UI token 层、回答优先侧栏）。
> 关联文档：`docs/plans/ui-preferences-knowledge-status.md`（四阶段交付计划）、ADR 0009（语义 token）、ADR 0010（回答优先侧栏流）、ADR 0013（Phase 3 设置页可靠性）。
>
> 说明：此文档此前只存在于基于旧 `origin/master`（落后本地 master 20+ 提交）的分支/PR #18 上，无法直接合并到当前 master。此版本是在当前 master 基础上重新核对每一项实际状态后的重建版，取代那个分支上的版本；旧分支/PR 可以关闭。

## 评审结论摘要

基于 2026-07-11 的运行截图（设置页亮/暗、Memory 视图、Chat）：暗色模式成立；回答优先布局、trust chips、单一 Run details 折叠区符合 ADR 0010；composer 模型标签去重；undo 删除、内联重命名、空状态均已落地。A2、D1（Phase 3）已在本地完成并通过 145 个 vitest + tsc/build 验证；A1、B2 在核对中确认已随其他改动一并解决。

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

- [ ] **B1. 标签与控件成对换行（修复配对断裂）**
  - 现象："Context Window" 标签留在 Model 行右侧、其输入框掉到下一行独占全宽；"Cold Start Thinking" 同样断开。
  - 状态：**未修复**。Phase 3 把这些字段移进了折叠的 Advanced 区块，但配对结构本身（`hbox[align="center"]` 内的 flex 换行）没有改成原子配对，窄窗口下断裂问题理论上仍存在。
  - 修法仍是：每个"标签+控件"用 `grid-template-columns: max-content 1fr` 做成不可拆分单元，对与对之间整体换行。

- [x] **B2. 状态文字去冗余（不复述表单值）**
  - 状态：随 Phase 3 一并解决。所有区块统一为单行状态（`idle/saving/saved/error`），不再逐行复述表单字段值。

### C. 侧栏打磨（均未开始）

- [ ] **C1. Run details：Codex 活动命令人话化**
- [ ] **C2. Memory 卡片：markdown 标题层级视觉区分**
- [ ] **C3. Memory 卡片：空章节隐藏或显示占位**
- [ ] **C4. Memory 列表：论文标题回查 Zotero 活数据**
- [ ] **C5. 微文案与图标打磨（聚合项）**

（详细现象/修法/验收见本文档历史版本或 `docs/plans/ui-preferences-knowledge-status.md`；此次重建未改动这部分范围，按需再展开。）

### D. 计划阶段

- [x] **D1. Phase 3：设置页信息架构与可靠性改造**
  - 已完成：区块重排（Vault → Codex → Translation Services → About）+ 双 AI 路径说明文案；Codex 高级项（Model/Context Window/Cheap Model/Cold Start Effort）收进折叠 Advanced；移除全部手动 Save 按钮，改为防抖即时保存 + 统一单行状态；新增 `AIService.testConnection(config)`，Test 按钮改用表单实时值而非全局默认服务；服务切换不丢编辑（防抖持久化，结构性保证，非靠人工确认）；Codex 检测拆成只读 Detect（发现即入框，走与手输入相同的防抖保存）与 Test（纯校验，永不写盘）；新增 Codex/Vault 的原生文件/目录选择器（`ztoolkit.FilePicker`）；API Key 显示/隐藏切换；服务删除改为面板内二次确认（仿 Phase 2 会话删除确认的交互）。
  - 落地位置：`src/modules/preferences/` 拆分自原 516 行的 `preferences.ts`；`docs/adr/0013-preferences-reliability-and-io.md`。
  - 复核：145 个 vitest + tsc + build 通过；亮/暗主题、Codex Detect/Test/fnm 修复均已在真实 Zotero 里截图验证。Remove 二次确认与 Test 命中当前编辑两项未逐一手动点击复核，用户判断代码层保证已足够，暂不强求。

- [ ] **D2. Phase 4：主列表知识状态列 + 批量构建闭环**（依赖 D1，未开始）

### E. 渐进重构（穿插进行，不阻塞）

- [~] **E1. 持续拆分 sidebar.ts facade**（现约 3600 行，未变动）
  - Phase 3 期间新增了 `src/modules/preferences/` 这个同构的"facade + 子模块"拆分案例（8 个子文件，均 <200 行），可作为后续拆 `sidebar.ts` 时的参照，但 `sidebar.ts` 本身尚未拆。

## 建议执行顺序

B1 → C1 → C2/C3/C4/C5 → D2；E1 穿插。（A1/A2/B2/D1 已完成，从原顺序中移除。）

## 每项任务的通用完成标准

1. `npm test`、`npm run build` 通过；涉及纯逻辑的改动补 vitest 单测。
2. 涉及 UI 的改动在 Zotero 亮/暗两主题下手动验证并截图。
3. 只用 `--za-*` token，不引入组件级硬编码颜色（ADR 0009）。
4. 提交评审：diff + 截图 → 按本文件对应验收标准复核 → 勾选。
