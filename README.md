# Zotero Agent

Zotero Agent 是一个面向 Zotero 7/8 的 AI 阅读助手插件。当前主线架构已经从自研 RAG 聊天切换为 **Codex CLI + Knowledge Vault**：用户在 Zotero PDF Reader 侧栏中和 Codex 对话，插件负责提取论文全文、维护跨论文记忆文件，并把每轮学习结果提交到本地 git vault。

## 功能概览

- 在 PDF Reader 侧栏中直接向 Codex 提问当前论文。
- 自动为当前论文准备 `text.txt`、`memory.md`、`record.json` 和会话日志。
- 在同一篇论文下创建、切换、重命名、删除多个独立聊天会话。
- 每个聊天会话可独立选择 Codex 模型和 Thinking 强度。
- 通过 Memory 视图查看当前论文的 Knowledge Surface、浏览 Vault 中的论文、跨论文搜索 `memory.md`。
- 在对话中用 `@` 提及 Vault 中的其他论文，让 Codex 基于多篇 Paper Knowledge Records 进行比较和关联。
- 在输入框粘贴本地截图并随问题发送给 Codex；截图保存在 Vault 的 gitignored 本地目录。
- 按 L0–L3 选择论文投入深度；L1 为默认速读，L2 为精读，L3 可绑定显式 GitHub 仓库并生成代码分析。
- 将用户思考追加到独立的 `notes.md`，与论文事实和会话日志保持结构隔离。
- 多选 Vault 论文后显式创建可持续更新的 Topic Note，沉淀问题定义、方法脉络、论文立场与开放问题。
- 从 Memory 视图建立单篇 Knowledge Record，或在 Zotero 多选后通过右键菜单批量建档。
- 为论文记录 1–5 星评分，并镜像 Zotero collections/tags 作为 Paper Signal Metadata。
- Codex 可在当前论文的 `memory.md` 中写入 Semantic Relationships，插件会生成 `record.json` 供脚本、索引和图谱使用。
- 在 Codex 回复中查看命令执行活动、Knowledge 更新、关系审查和 Vault 保存状态。
- 选中文本后通过 Reader 弹窗执行 `Ask` 或 `Translate` 快捷操作。

## Knowledge Vault

默认 Vault 目录是 `~/papers`，可在插件偏好设置中修改。插件会把它初始化为一个 git 仓库，并在每轮 Codex 对话后提交 memory 和 conversation 变更，方便审查和回滚。

每篇论文使用 Zotero `itemKey` 作为目录名：

```text
~/papers/
  vault.json
  AGENTS.md
  .generated/
  .logs/
  {itemKey}/
    text.txt
    text.meta.json
    memory.md
    notes.md
    record.json
    code-notes.md
    code/
    figures/
      local/
      generated/
    conversations/
      {sessionId}.md
  topics/
    {topic-slug}.md
```

三层记忆职责：

- **Codex Session**：由 Codex `thread_id` 管理，用于同一个侧栏会话内的短期推理连续性。
- **Conversation Log**：`conversations/{sessionId}.md`，按会话隔离的人类可读对话记录，不作为长期检索记忆。
- **Paper Knowledge Record**：一篇论文的可演化研究档案；`memory.md` 保存论文知识，`notes.md` 追加保存 Reader Thinking。
- **Structured Projection**：`record.json`，由插件从 `memory.md` 生成，服务脚本、搜索、反向链接和图谱。

`memory.md` 使用 L0–L3 分层模板。L1 默认包含 `TL;DR`、`Contribution`、`Method`、`Takeaways`；L2/L3 扩展为精读结构。页证据由正文内 `[page N]` 自动投影到 `record.json`。跨论文关系使用 typed Semantic Relationship，例如：

```markdown
- [extends] [Paper title](../OTHERKEY/memory.md): rationale. Evidence: [page 4]
```

## 配置

侧栏聊天需要本机已安装并配置好 Codex CLI。插件会自动尝试解析可工作的 `codex` 路径，也可以在偏好设置中手动指定。每个聊天会话可从当前 Codex catalog 中选择模型和 Thinking 强度；`Codex default` / `Thinking default` 继续继承用户配置，选择结果按会话保存。

偏好设置中还保留 AI 服务配置，用于非 Codex 功能，例如划词翻译和接口连通性测试。侧栏的模型选择不是旧式 provider 路由：列表动态来自 `codex debug models`，实际调用仍完全由 Codex CLI 执行。

## 开发指南

### 环境要求

- Node.js 18+
- Zotero 7/8
- Codex CLI

### 常用命令

```bash
npm install
npm run start
npm run build
npm test
```

- `npm run start`：开发模式运行，使用 `zotero-plugin serve`。
- `npm run build`：类型检查并生产构建，输出到 `build/` 目录。
- `npm test`：跑纯逻辑单元测试（vitest；不依赖 Zotero 运行时）。

### 核心目录

- `src/modules/sidebar.ts`：侧栏 UI、多会话、`@` paper mention、Codex 流式输出、Memory 视图。
- `src/services/codex/`：Codex CLI 路径解析、JSONL 事件解析、subprocess 执行、Vault 管理。
- `src/services/codex/vault-format.ts`：Knowledge Surface 模板、Semantic Relationship 解析和 `record.json` projection helpers。
- `src/services/chat-store.ts`：每篇论文的多会话元数据和消息持久化。
- `src/modules/pdf-context.ts`：PDF 全文提取 fallback。
- `src/services/pdf-parser.ts`：用于 Vault 的 PDF.js 页面文本解析。
- `src/modules/popup.ts`：Reader 选区弹窗。
- `src/services/ai-service.ts`：非 agent 功能使用的 AI API 客户端。
- `src/modules/preferences.ts`：Codex 路径、Vault 路径和 AI 服务配置页面。

## 已移除的旧功能

当前主线已移除旧自研 RAG 聊天管线、`/init`、`/summary`、`/compact` slash commands、context-PDF 附件，以及聊天区 provider 选择器。`@` mention 已以 Vault Papers only 的方式重新引入；图片输入以本地剪贴板截图形式恢复。

## 许可证

AGPL-3.0-or-later
