# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start    # Development mode with hot reload (zotero-plugin serve)
npm run build    # Type-check then production build → build/ directory
npm run release  # Create a release build
npm run lint     # Prettier + ESLint auto-fix
npm test         # Vitest unit tests (pure helpers: vault-format, page-evidence, codex events, etc.)
```

Unit tests cover pure logic only (no Zotero runtime). Runtime behavior is validated manually in Zotero — see `docs/benchmarks/`.

To build for development, run `npm run start`. The plugin output goes to `build/` and is served to a running Zotero instance.

## Architecture Overview

This is a **Zotero 7/8 plugin** that adds an AI-powered reading assistant to the PDF reader. It is built with TypeScript using the [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) scaffold.

### Plugin Lifecycle

- **`src/index.ts`** — Global entry; attaches the `ZoteroAgent` singleton to the window
- **`src/addon.ts`** — Central singleton managing plugin data, service registry, and UI references
- **`src/hooks.ts`** — Zotero lifecycle hooks (startup, shutdown, window load, reader open/close, popup)

### UI Modules (`src/modules/`)

| Module           | Responsibility                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `sidebar.ts`     | Main chat panel: session management, message rendering, Codex streaming updates, Memory view |
| `popup.ts`       | In-reader text-selection popup with "Ask" and "Translate" quick actions                      |
| `pdf-context.ts` | Full-text extraction via Zotero PDFWorker (`getFullText`), trimming trailing references      |
| `preferences.ts` | Settings UI for AI service configuration                                                     |
| `reader.ts`      | Reader lifecycle integration                                                                 |

### Service Layer (`src/services/`)

| Service         | Responsibility                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-service.ts` | Abstract AI API client used by non-agent features such as popup translation and preference API checks                                               |
| `codex/`        | Codex CLI integration: binary resolution, Mozilla subprocess wrapper, JSONL event parsing, Vault prep, and turn execution                           |
| `chat-store.ts` | Session persistence; saves per-paper JSON files to `{ZoteroDataDir}/zoteroagent/chats/{itemKey}.json` (front-end/UI state only — see Storage below) |
| `prompts.ts`    | Popup translation prompt                                                                                                                            |

### Agent Execution Flow

When a user submits a question in the sidebar (`sidebar.ts::submitQuestion`):

1. Resolve the in-focus Zotero item and PDF attachment.
2. Prepare the configured Knowledge Vault (`~/papers` by default): per-paper `text.txt` (extracted via Zotero PDFWorker; form-feed page breaks become `[page N]` markers), `text.meta.json` parser-version stamp, `memory.md`, session conversation log, root `AGENTS.md`, and git repo.
3. Run `codex exec --json -C {vault} -s workspace-write ...` via Mozilla Subprocess.
4. Parse Codex JSONL events into sidebar updates, activity steps, usage, and the assistant answer.
5. Append the conversation turn, detect whether `memory.md` changed, and git-commit Vault changes.

### AI Provider Support

Providers are configured in `src/utils/provider-presets.ts`. Supported API formats:

- `chat-completions` — OpenAI, Azure, DeepSeek, Kimi, Gemini, GLM, Qwen, etc.
- `anthropic` — Claude native (with extended thinking support)
- `responses` — Custom reasoning format

### Key Data Structures

**Session file** (`{ZoteroDataDir}/zoteroagent/chats/{itemKey}.json`):

```typescript
{
  version: 2,
  itemId, itemKey, paperTitle,
  activeSessionId,
  sessions: [{
    sessionId, codexThreadId, title,
    contextMode: "agent",
    messages: ChatMessage[],
    createdAt, updatedAt
  }]
}
```

### Storage & Source of Truth

Plugin state lives in three roots, split by purpose:

| Location                                                                 | Contents                                                                                                                                                                                                                               | Role                                                                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Knowledge Vault** — `~/papers` (or pref `codex.vaultPath`), a git repo | per-paper `{itemKey}/`: `text.txt`, `text.meta.json` (parser-version stamp), `memory.md` (Knowledge Surface), `record.json` (Structured Projection), `conversations/{sessionId}.md`; root `AGENTS.md`, `README.md`, `.logs/{date}.log` | **Single source of truth.** Durable, migratable, git-versioned. Codex's working directory (`codex exec -C {vault}`). |
| **Zotero DataDir** — `{ZoteroDataDir}/zoteroagent/`                      | `chats/{itemKey}.json` (sessions/messages/`codexThreadId`, UI-specific fields)                                                                                                                                                         | Front-end/UI state. Ephemeral — not git-tracked.                                                                     |
| **Zotero Prefs** (`Zotero.Prefs`)                                        | vault path, Codex binary path, model slugs, context-window override, AI services list                                                                                                                                                  | Configuration.                                                                                                       |

**Deliberate dual-write of conversations.** Each turn is persisted twice: the structured session JSON in `chats/` (what the sidebar renders, with per-message reasoning/activities/usage) and a human-readable transcript in the Vault's `conversations/*.md` (git history, browsable record). This is intentional — deleting a session in the UI touches only `chats/` and leaves the Vault record intact. `conversations/*.md` is **append-only** and is not read back by the UI, so it can diverge from edited UI history by design; the Vault is authoritative.

`~/.codex/` is **read-only** to the plugin (model/context-window resolution). The Codex CLI itself writes its own thread rollouts there when we run `codex exec`.

### Build System

- **Bundler**: esbuild (via `zotero-plugin` CLI) targeting Firefox 128
- **Source roots**: `src/` (TypeScript) and `addon/` (XUL/CSS/FTL assets)
- **Config**: `zotero-plugin.config.ts`
- TypeScript strict mode; `tsconfig.json` targets ES2020
- ESLint rules are relaxed for `@ts-ignore`, `any`, and unused vars (common in Zotero plugin development)
