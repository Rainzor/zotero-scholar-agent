---
status: accepted
---

# Replace the custom RAG pipeline with the Codex CLI as agent engine

## Context

The plugin's agent is currently a self-built, single-paper RAG pipeline (`agent-executor.ts` + `ai-service.ts`): plan pages → load page text → stream an answer, with a per-paper page cache, an `AGENTS.md` overview, per-page citations, multimodal image asks, context-PDF references, multi-provider HTTP config, and token budgeting. Its structural limit is that it reasons about *one paper at a time* and has no durable, cross-paper memory. The stated product goal is the opposite: accumulate and retrieve knowledge *across the whole library* as the user reads many papers over time.

## Decision

Replace the custom RAG pipeline with the external OpenAI **Codex CLI** as the reasoning engine, driven headlessly from the sidebar via `codex exec --cd ~/papers --json` (spawned through Mozilla `Subprocess`, stdout parsed as JSONL). Durable memory lives in a dedicated, plugin-owned git **Knowledge Vault** at `~/papers`:

```
~/papers/
├── AGENTS.md
├── README.md
└── {itemKey}/          # Zotero item key, e.g. PXW99EKT
    ├── text.txt        # plugin-extracted PDF text (read-only for Codex)
    ├── conversations/  # human transcript logs, one file per sidebar session
    │   └── {sessionId}.md
    └── memory.md       # durable semantic memory (Codex read/write)
```

Codex is the engine; the Vault is the memory. Source PDFs stay in Zotero `storage/`; Codex gets `workspace-write` only on the Vault.

## Considered options

- **Coexist** (Codex as a separate mode next to the RAG agent) — rejected: chose Replace for a single coherent product.
- **Codex as invisible backend** (keep UI/pipeline, route generation through Codex) — rejected: doesn't unlock cross-paper file/tool memory.
- **Codex as a tool the RAG agent calls** — rejected: keeps single-paper reasoning as the primary shape.
- **Official Codex SDK (Node/Python)** — infeasible: the plugin runs in Zotero's Gecko runtime, not Node; must spawn the CLI binary directly.

## Consequences

- **Lost until rebuilt:** in-plugin multi-provider config (Azure/DeepSeek/Kimi/GLM/…), multimodal figure asks, per-page citation UX, and token budgeting. Non-OpenAI users depend entirely on their local `~/.codex` config.
- **"Memory" is not automatic.** Codex has no cross-session learning; usefulness depends on the note-update discipline encoded in the Vault's `AGENTS.md`. This is now the core engineering risk, not the plumbing.
- **Security posture changes.** A reference manager now spawns a shell/file-capable coding agent. Mitigated by sandboxing writes to the Vault and surfacing every change as a reviewable, revertible git diff.
- **Hard to reverse** once the Vault format and users' accumulated notes exist.
