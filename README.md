# Zotero Agent

Zotero Agent 是一个面向 Zotero 7 的 AI 阅读助手插件，专注于 PDF 阅读场景下的提问、翻译、摘要与会话管理。

## 用户指南

### 你可以做什么

- 在 PDF Reader 中打开 Agent Chat 侧栏对话
- 选中文本后通过弹窗直接 `Ask`（带引用）或 `Translate`
- 对同一篇论文创建多个独立对话会话
- 在重启 Zotero 后恢复历史会话

### 会话机制

- 会话隔离范围：`paper(itemKey) -> sessions[] -> activeSession`
- 同一篇论文内支持：新建、切换、重命名、删除会话
- 不同论文之间会话互不可见
- 默认命名策略：
  - 新建：`新会话 N · HH:mm`
  - 首条用户消息后：自动改为首句摘要（若未手动重命名）

### 上下文模式

- `对话`：仅基于对话历史
- `所在页文本`：注入当前 PDF 页面文本
- `整篇PDF`：注入全文文本

### 服务配置

在插件偏好设置中可配置多个 AI 服务：

- 新增/删除服务
- 设置默认服务
- 编辑 `API URL`、`API Key`、`Model`
- 测试接口连通性

## 开发指南

### 环境要求

- Node.js 18+
- Zotero 7

### 常用命令

```bash
npm install
npm run start
npm run build
```

- `npm run start`：开发模式运行
- `npm run build`：生产构建（输出到 `build` 目录）

### 核心目录

- `src/modules/sidebar.ts`：侧栏 UI、消息渲染、交互逻辑
- `src/services/chat-store.ts`：多会话管理、持久化、压缩策略
- `src/modules/popup.ts`：Reader 选区弹窗（Ask/Translate）
- `src/modules/pdf-context.ts`：页级/全文上下文提取
- `src/services/ai-service.ts`：AI 请求与流式处理
- `src/modules/preferences.ts`：服务配置页面

## 许可证

AGPL-3.0-or-later
