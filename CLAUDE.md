# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start    # Development mode with hot reload (zotero-plugin serve)
npm run build    # Type-check then production build → build/ directory
npm run release  # Create a release build
npm run lint     # Prettier + ESLint auto-fix
```

There are no tests (`npm test` is unimplemented).

To build for development, run `npm run start`. The plugin output goes to `build/` and is served to a running Zotero instance.

## Architecture Overview

This is a **Zotero 7/8 plugin** that adds an AI-powered reading assistant to the PDF reader. It is built with TypeScript using the [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) scaffold.

### Plugin Lifecycle

- **`src/index.ts`** — Global entry; attaches the `ZoteroAgent` singleton to the window
- **`src/addon.ts`** — Central singleton managing plugin data, service registry, and UI references
- **`src/hooks.ts`** — Zotero lifecycle hooks (startup, shutdown, window load, reader open/close, popup)

### UI Modules (`src/modules/`)

| Module              | Responsibility                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `sidebar.ts`        | Main chat panel (~2000 lines): session management, message rendering, streaming updates, slash commands, image upload |
| `popup.ts`          | In-reader text-selection popup with "Ask" and "Translate" quick actions                                               |
| `pdf-context.ts`    | Extracts text from PDF.js DOM text layers; caches via page-cache service                                              |
| `slash-commands.ts` | Slash command parsing and autocomplete menu (`/init`, `/summary`, `/compact`)                                         |
| `preferences.ts`    | Settings UI for AI service configuration                                                                              |
| `reader.ts`         | Reader lifecycle integration                                                                                          |

### Service Layer (`src/services/`)

| Service              | Responsibility                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-service.ts`      | Abstract AI API client supporting `chat-completions` (OpenAI-compatible), `anthropic`, and `responses` formats; handles streaming, multimodal, and extended thinking |
| `agent-executor.ts`  | Core agent pipeline: generates paper AGENTS.md overview, plans which PDF pages to load, builds context-aware prompts, streams response                               |
| `chat-store.ts`      | Session persistence; saves per-paper JSON files to `{ZoteroDataDir}/extension/zotero-agent/{itemKey}.json`                                                           |
| `prompts.ts`         | All system prompts: Q&A, context planning, paper init, translate, explain                                                                                            |
| `context-builder.ts` | Assembles message history respecting token limits                                                                                                                    |
| `page-cache.ts`      | Caches parsed PDF pages to avoid re-parsing                                                                                                                          |
| `paper-overview.ts`  | Reads/writes AGENTS.md per paper                                                                                                                                     |

### Agent Execution Flow

When a user submits a question in the sidebar (`sidebar.ts::submitQuestion`):

1. Load message history and paper overview (AGENTS.md)
2. **`agent-executor.ts::executeAgent`**:
   a. Parse all PDF pages and cache them (once per paper)
   b. Generate AGENTS.md if missing (calls LLM on full paper text)
   c. **Context planning**: call LLM with the question + AGENTS.md → JSON list of relevant page numbers
   d. Load selected pages from cache
   e. Build final prompt: system prompt + AGENTS.md + page content + chat history
   f. Stream answer via `AIService.chat()`
3. Update UI with streaming tokens; render thinking blocks, token usage, page references

### AI Provider Support

Providers are configured in `src/utils/provider-presets.ts`. Supported API formats:

- `chat-completions` — OpenAI, Azure, DeepSeek, Kimi, Gemini, GLM, Qwen, etc.
- `anthropic` — Claude native (with extended thinking support)
- `responses` — Custom reasoning format

### Key Data Structures

**Session file** (`{dataDir}/extension/zotero-agent/{itemKey}.json`):

```typescript
{
  version: 2,
  itemId, itemKey, paperTitle,
  activeSessionId,
  sessions: [{
    sessionId, title,
    contextMode: "agent" | "none" | "currentPage",
    messages: ChatMessage[],
    summaryText?,     // compacted history
    summaryUpToIndex?,
    createdAt, updatedAt
  }]
}
```

### Build System

- **Bundler**: esbuild (via `zotero-plugin` CLI) targeting Firefox 128
- **Source roots**: `src/` (TypeScript) and `addon/` (XUL/CSS/FTL assets)
- **Config**: `zotero-plugin.config.ts`
- TypeScript strict mode; `tsconfig.json` targets ES2020
- ESLint rules are relaxed for `@ts-ignore`, `any`, and unused vars (common in Zotero plugin development)
