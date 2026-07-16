---
status: accepted
track: both
---

# Per-chat Codex reasoning effort

## Context

Codex models expose different reasoning-effort levels. Research turns range
from quick factual lookups to deep synthesis, so users need to control this
tradeoff without changing global Codex configuration.

The Codex model catalog advertises each model's supported and default reasoning
efforts. `codex exec` and resumed threads accept an invocation override through
`config.model_reasoning_effort`.

## Decision

Each sidebar Chat Session stores an optional reasoning effort. Empty means
inherit the Codex/model default. The compose toolbar lists only efforts
advertised by the selected model; when using `Codex default`, it shows the
catalog-supported union.

The selected value is passed per invocation as:

```text
-c model_reasoning_effort="{effort}"
```

It applies to fresh and resumed research turns, does not edit
`~/.codex/config.toml`, and is reset to default if a model switch makes the
stored effort unsupported.

## Consequences

- Users can trade latency/cost for reasoning depth per conversation.
- Different sessions on the same paper retain independent effort choices.
- Temporary workflows such as Context Digest and batch Cold Start keep their
  own model/default reasoning behavior.
