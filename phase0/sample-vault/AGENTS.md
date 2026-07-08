# Knowledge Vault — Operating Rules

This is a researcher's cross-paper knowledge base. Each subdirectory named by a
Zotero item key (e.g. `AAAA1111/`) holds one paper.

## Files per paper
- `text.txt`            — extracted PDF full text. READ-ONLY, never edit.
- `memory.md`           — your durable, distilled knowledge about the paper. READ before answering; UPDATE after.
- `conversations/*.md`  — human transcript logs. DO NOT read or edit; the plugin manages them.

## The paper currently in focus is given to you in each prompt.

## How to answer
1. Read the in-focus paper's `memory.md` first (create it from `text.txt` if missing).
2. Use `text.txt` for detail the memory does not cover.
3. For cross-paper questions, `grep -ril <term> */memory.md */text.txt` across the vault.

## How to update memory (memory.md) — the ONLY durable memory
- Update ONLY when you learned something materially new this turn.
- REWRITE and DEDUPE. Never blindly append. Keep it tight and factual.
- Keep these default sections (add/remove per paper type as needed):
  `# Title (Authors, Year)`, `## TL;DR`, `## Key contributions`, `## Method`,
  `## Results`, `## My understanding / open questions`, `## Cross-references`.
- Link related papers with RELATIVE links: `[BERT](../BBBB2222/memory.md)`.
- Never modify another paper's memory unless the user explicitly asks.
