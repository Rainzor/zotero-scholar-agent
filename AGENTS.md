# AGENTS.md

## Project Intent

This repository builds a Zotero 7/8 plugin that embeds Codex as an agentic research assistant inside Zotero. The product goal is:

> 沉淀用户的对话记忆和思考，提炼 paper 的精华，形成一个有 agent 集成、不断进化的学术知识库。

In practical terms, the plugin should help researchers analyze, search, summarize, connect, and get inspiration from papers while preserving the user's evolving thinking as durable knowledge.

## Current Architecture

- The plugin is TypeScript-based and uses `zotero-plugin-toolkit` / `zotero-plugin-scaffold`.
- The main user surface is the Zotero PDF Reader sidebar in `src/modules/sidebar.ts`.
- Codex CLI is the primary reasoning engine. The plugin launches Codex from Zotero through Mozilla `Subprocess`.
- Durable knowledge lives in a plugin-owned Knowledge Vault, defaulting to `~/papers`.
- Source PDFs remain in Zotero storage. The Vault contains only derived artifacts and should be safe to review, diff, and regenerate.

Knowledge Vault layout:

```text
~/papers/
  AGENTS.md
  README.md
  .logs/
  {itemKey}/
    text.txt
    memory.md
    conversations/
      {sessionId}.md
```

Keep the three memory layers distinct:

- Codex Session: short-term Codex reasoning continuity for one sidebar chat, represented by `thread_id`.
- Conversation Log: `conversations/{sessionId}.md`, an episodic human-readable transcript. Do not treat it as long-term semantic memory.
- Memory Note: `memory.md`, the distilled long-term knowledge for one paper. This is the cross-paper retrieval target.

## Engineering Priorities

- Prefer the existing Codex + Knowledge Vault direction over reintroducing the old custom RAG pipeline.
- Keep paper text extraction deterministic and plugin-owned. `text.txt` is raw source material, not agent-authored memory.
- Make memory changes reviewable. The Vault's git history is part of the product design.
- Preserve user agency and privacy: avoid sending or writing more paper/user data than needed for the requested workflow.
- Keep UI changes aligned with Zotero's reader/sidebar style. This is a research workflow tool, so favor dense, stable, low-distraction interfaces.
- When adding features, preserve multi-session behavior per paper unless the task explicitly changes it.

## Code Map

- `src/modules/sidebar.ts`: sidebar UI, chat sessions, Codex turn orchestration, Memory view.
- `src/services/codex/`: Codex path resolution, subprocess execution, event parsing, Vault preparation and commits.
- `src/services/codex/vault-format.ts`: Vault file naming and formatting helpers.
- `src/services/chat-store.ts`: Zotero-side per-paper chat/session persistence.
- `src/modules/pdf-context.ts`: Zotero PDF text extraction fallback.
- `src/services/pdf-parser.ts`: PDF.js extraction for Vault `text.txt`.
- `src/modules/popup.ts`: reader selection popup actions such as Ask and Translate.
- `src/services/ai-service.ts`: non-Codex API client for auxiliary AI features.
- `src/modules/preferences.ts`: Codex path, Vault path, and AI service preferences.

## Commands

```bash
npm install
npm run start
npm run build
npm test
npm run lint
```

- `npm run start`: development server via `zotero-plugin serve`.
- `npm run build`: TypeScript check plus production build.
- `npm test`: Vitest unit tests.
- `npm run lint`: Prettier and ESLint auto-fix.

Run the narrowest useful verification after edits. For shared Codex/Vault logic, prefer adding or updating Vitest tests.

## Delivery Pipeline Constraints

For work organized under `docs/plans/`, treat each confirmed phase as a
bounded product delivery, not a general cleanup opportunity.

1. Define the phase boundary before editing: one user-visible goal, explicit
   acceptance criteria, and explicit non-goals.
2. Implement the smallest vertical slices that satisfy that phase. Add focused
   tests at stable logic seams; do not invent UI implementation tests that the
   runtime cannot support.
3. Do not combine a user-visible feature, its acceptance fixes, and a
   large-scale module refactor in one phase. Once the feature passes its
   acceptance criteria, stop. Plan structural refactoring as a separate phase
   with its own tests and review.
4. Verify in this order before asking for product confirmation:
   - targeted tests and type check;
   - full `npm test`;
   - `npm run build`;
   - focused formatting/static checks;
   - Zotero runtime checks for affected light/dark, narrow-width, keyboard,
     and workflow states.
5. Perform a bounded review against the active phase specification. Fix
   blocking correctness, data-loss, accessibility, and acceptance failures.
   Record non-blocking architecture opportunities for a later phase instead
   of expanding the current one.
6. Do not mark a phase `Confirmed` until the user has completed the requested
   runtime acceptance checks. If code is implemented but awaiting that review,
   state `Implemented; awaiting confirmation`.
7. Make one intentional commit per confirmed phase. Its diff must exclude
   unrelated pre-existing work. Do not commit while the phase is in the middle
   of a refactor or while required verification is incomplete.

When a phase is redirected or a new user request arrives, pause the current
implementation, report the exact state (implemented, verified, and
unverified), then update the phase boundary before resuming.

## Documentation Rules

- Read `README.md`, `CONTEXT.md`, and `docs/adr/` before changing architecture.
- For design changes, update or add an ADR under `docs/adr/`.
- Keep vocabulary consistent with `CONTEXT.md`: "Knowledge Vault", "Paper Directory", "Conversation Log", "Memory Note", "In-Focus Paper", and "Item Key".

## Dependency Documentation

Use Context7 MCP to fetch current documentation whenever working with a library, framework, SDK, API, CLI tool, or cloud service. Start with `resolve-library-id` unless an exact `/org/project` library ID is already provided, then call `query-docs` with the selected library ID and the full question.

Prefer Context7 over web search for library documentation. Do not use Context7 for general refactoring, business-logic debugging, code review, or broad programming concepts.
