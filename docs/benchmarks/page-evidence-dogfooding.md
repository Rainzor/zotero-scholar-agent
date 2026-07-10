# Page Evidence Dogfooding Benchmark

Use this note when validating page evidence chips in real Zotero sessions. The goal is to verify PDF page jumps while collecting realistic context-cost data.

## Page Evidence Validation

| Scenario | Expected | Result | Notes |
| ---- | ---- | ---- | ---- |
| Assistant answer contains `[page 1]` | Renders as page chip and jumps to first PDF page |  |  |
| Assistant answer contains `[page 2]` | Jumps to second PDF page; no off-by-one error |  |  |
| `[page N]` inside fenced code | Remains plain text |  |  |
| `[page N]` inside inline code | Remains plain text |  |  |
| `[page N]` inside link text | Remains plain text |  |  |
| Reader closed/unavailable | Chip is disabled or reports failure without throwing |  |  |
| Page out of range | Chip disabled or reports out-of-range state |  |  |
| Disabled chip, then open the PDF reader | Clicking the chip re-evaluates and jumps (self-recovery) |  |  |
| `Evidence: [page N]` in Knowledge review block | Renders as clickable page chip |  |  |

## Token And Latency Samples

Record `turn.completed.usage` from the sidebar and wall-clock time from pressing Send to final answer.

| Date | Paper | Path | Wall-clock | Input tokens | Cached input | Output tokens | Context used | Notes |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
|  |  | resume existing thread |  |  |  |  |  |  |
|  |  | fresh thread |  |  |  |  |  |  |
|  |  | digest fallback |  |  |  |  |  |  |

## Context Digest Quality Samples

Use at least two long sessions. Compact the session, continue in a fresh thread, then judge whether the answer preserves the needed task state.

| Date | Paper | Digest source | Continuation prompt | Result quality | Missing context | Notes |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
|  |  | codex-cheap / codex-default / deterministic |  |  |  |  |
|  |  | codex-cheap / codex-default / deterministic |  |  |  |  |

