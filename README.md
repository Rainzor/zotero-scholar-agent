# Zotero Agent

Zotero Agent 是一个面向 Zotero 7/8 的 AI 阅读助手插件。当前主线架构已经从自研 RAG 聊天切换为 **Codex CLI + Knowledge Vault**：用户在 Zotero PDF Reader 侧栏中和 Codex 对话，插件负责提取论文全文、维护跨论文记忆文件，并把每轮学习结果提交到本地 git vault。

## 功能概览

- 在 PDF Reader 侧栏中直接向 Codex 提问当前论文。
- 自动为当前论文准备 `text.txt`、`memory.md` 和会话日志。
- 在同一篇论文下创建、切换、重命名、删除多个独立聊天会话。
- 通过 Memory 视图查看当前论文记忆、浏览 Vault 中的论文、跨论文搜索 `memory.md`。
- 在 Codex 回复中查看命令执行活动、memory 更新和 vault 保存状态。
- 选中文本后通过 Reader 弹窗执行 `Ask` 或 `Translate` 快捷操作。

## Knowledge Vault

默认 Vault 目录是 `~/papers`，可在插件偏好设置中修改。插件会把它初始化为一个 git 仓库，并在每轮 Codex 对话后提交 memory 和 conversation 变更，方便审查和回滚。

每篇论文使用 Zotero `itemKey` 作为目录名：

```text
~/papers/
  AGENTS.md
  .logs/
  {itemKey}/
    text.txt
    memory.md
    conversations/
      {sessionId}.md
```

三层记忆职责：

- **Codex Session**：由 Codex `thread_id` 管理，用于同一个侧栏会话内的短期推理连续性。
- **Conversation Log**：`conversations/{sessionId}.md`，按会话隔离的人类可读对话记录，不作为长期检索记忆。
- **Memory Note**：`memory.md`，Codex 读取和更新的长期语义记忆，也是跨论文搜索的唯一目标。

## 配置

侧栏聊天需要本机已安装并配置好 Codex CLI。插件会自动尝试解析可工作的 `codex` 路径，也可以在偏好设置中手动指定。

偏好设置中还保留 AI 服务配置，用于非 Codex 功能，例如划词翻译和接口连通性测试。侧栏聊天不再使用 Kimi、DeepSeek、GLM、Claude 等 provider 下拉选择，实际回答模型由 Codex CLI 自身配置决定。

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

- `src/modules/sidebar.ts`：侧栏 UI、多会话、Codex 流式输出、Memory 视图。
- `src/services/codex/`：Codex CLI 路径解析、JSONL 事件解析、subprocess 执行、Vault 管理。
- `src/services/chat-store.ts`：每篇论文的多会话元数据和消息持久化。
- `src/modules/pdf-context.ts`：PDF 全文提取 fallback。
- `src/services/pdf-parser.ts`：用于 Vault 的 PDF.js 页面文本解析。
- `src/modules/popup.ts`：Reader 选区弹窗。
- `src/services/ai-service.ts`：非 agent 功能使用的 AI API 客户端。
- `src/modules/preferences.ts`：Codex 路径、Vault 路径和 AI 服务配置页面。

## 已移除的旧功能

当前主线已移除旧自研 RAG 聊天管线、`/init`、`/summary`、`/compact` slash commands、context-PDF 附件、图片上传、`@` mention 附加库中文献，以及聊天区 provider 选择器。

## 许可证

AGPL-3.0-or-later
