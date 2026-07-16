---
status: accepted
track: both
---

# Add a hidden Context Digest for long sidebar chats

## Context

Codex's `thread_id` gives one sidebar chat short-term continuity, but long sessions can still approach the model context limit. The old plugin-side compaction replaced older visible messages with an assistant-looking summary, which conflated the user-facing transcript with machine context and made the Conversation Log less trustworthy.

The product needs compact continuation state without pretending that compacted text was an assistant reply, without writing generic compression into `memory.md`, and without feeding verbose Conversation Logs back into Codex.

## Decision

Add a session-level **Context Digest** stored as hidden metadata on `ChatSession`:

```text
contextDigest
contextDigestUpToMessageIndex
contextDigestUpdatedAt
contextDigestTokenEstimate
contextDigestSource
```

The digest is hidden machine context. After a digest is saved, the session's `codexThreadId` is cleared so the next research turn starts a fresh Codex thread using the digest plus recent visible turns. The full visible message list remains intact unless the user deletes or edits messages.

Digest generation uses a compact instruction that preserves user intent, unresolved questions, paper-grounded facts, reader thinking, constraints, tool outcomes, file paths, Item Keys, page/evidence pointers, and mentioned papers. It tries the configured cheap Codex model first, falls back to the default Codex model, and finally falls back to a deterministic local digest if Codex compaction fails.

The UI exposes this only as a status/debug control:

- `Context compacted · covers N turns`
- a manual `Compact` action
- an expandable `Hidden Context Digest` debug view

The digest is never appended to the Conversation Log and never written to `memory.md`.

## Consequences

- The visible transcript stays complete and honest.
- Future turns get compact continuity by replacing a swollen Codex thread with digest-backed fresh-thread context.
- `memory.md` remains reserved for durable Paper Knowledge Records, not session compression.
- Editing or deleting visible messages invalidates the digest because message indices and meaning may have changed.
- The digest prompt and deterministic fallback become part of session semantics and need unit coverage.
- Digest quality matters: once compacted, the old Codex thread is intentionally discarded for that sidebar session.
