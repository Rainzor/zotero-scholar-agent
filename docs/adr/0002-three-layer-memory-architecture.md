---
status: accepted
---

# Three-layer memory architecture for the Knowledge Vault

> Terminology note: ADR-0003 refines "Memory Note" into Paper Knowledge Record (domain object), Knowledge Surface (`memory.md`), and Structured Projection (`record.json`). This ADR remains accepted for the three-layer separation.

## Context

The product goal is cross-paper knowledge accumulation — the agent should get more useful the more the user reads. Codex has no automatic learning (see ADR-0001), so memory must be designed as files. The naive design — dump each chat transcript into a per-paper file and feed it back to Codex — fails: transcripts are verbose, full of dead ends, and would pollute cross-paper retrieval, while also conflating "what we said" with "what was actually learned."

## Decision

Separate memory into **three layers that are never conflated**, per paper directory `~/papers/{itemKey}/`:

1. **Codex Session** (rollout, `thread_id`) — short-term reasoning continuity within one sidebar chat. Ephemeral, disposable, Codex-internal.
2. **Conversation Log** (`conversations/{sessionId}.md`) — the episodic, human-facing transcript, **one file per chat session** so multiple sessions stay isolated (mirrors the existing multi-session UI). Appended every turn by the plugin. Reviewable by the user; **never fed to Codex as reasoning input**.
3. **Memory Note** (`memory.md`) — the semantic, internalized long-term knowledge. Codex reads and writes it; it is the *only* layer cross-paper retrieval searches.

`text.txt` (plugin-extracted PDF text) sits alongside as raw source, not memory. Codex updates `memory.md` agentically per the Vault's `AGENTS.md` rules — only on materially-new learning, rewriting/deduping rather than blind-appending. The plugin auto-commits the Vault to git after each turn, making every memory mutation a reviewable, revertible diff.

## Considered options

- **Single per-paper file mixing transcript + knowledge** — rejected: verbose transcript pollutes retrieval and blurs "said" vs "learned."
- **Feed the Conversation Log to Codex as context** — rejected: same pollution; short-term continuity is already covered by the Codex Session.
- **Update Memory Note only on an explicit user button** — rejected: memory stays sparse because users won't click; defeats "grows as you read."
- **Separate background "reconcile memory" turn after every answer** — rejected: doubles cost/latency per question.

## Consequences

- **Hard to reverse.** Once users accumulate `memory.md` files in this format, changing the format/layout means migrating their memory.
- Retrieval quality depends entirely on `AGENTS.md` discipline (dedupe, rewrite, conciseness) — this is the main ongoing engineering risk.
- Agentic writes add some per-turn latency/cost and occasional low-value edits; the git history makes pruning/reverting cheap.
- The Conversation Log is a pure human artifact — deleting it never harms Codex's memory.
