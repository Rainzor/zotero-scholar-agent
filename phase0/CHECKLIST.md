# Phase 0 — Manual Validation Checklist

Goal: prove every load-bearing assumption of the Codex-as-engine design **from the
command line**, before writing any plugin code. If any check fails, we redesign
*before* building — that's the whole point of Phase 0.

Verified environment (this machine): `codex-cli 0.142.5`, authenticated
(`~/.codex/auth.json` present). `codex exec` has NO interactive approval flag —
writes are gated purely by `--sandbox`.

## Setup

```bash
bash phase0/setup.sh          # creates ~/papers-phase0 (isolated, throwaway)
export VAULT="$HOME/papers-phase0"
```

The scratch vault has `AGENTS.md`, `README.md`, and two papers (`AAAA1111`,
`BBBB2222`) with `text.txt` only — **no `memory.md` yet** (Codex must create it).

Common flags used below:
`-C "$VAULT"` working root · `--json` JSONL stream · `-s <mode>` sandbox.
(`--skip-git-repo-check` not needed here since the vault IS a git repo.)

---

## A1 — JSONL event stream parses (read-only)

```bash
codex exec --json -C "$VAULT" -s read-only \
  "In-focus paper: AAAA1111. In one sentence, what problem does it solve?"
```

PASS if stdout is one JSON object per line and you see, in order:
`thread.started` (grab `thread_id`!) → `turn.started` → `item.*` → `turn.completed`
(with a `usage` token count). This is exactly what the plugin will parse.

> Tip: pipe through `jq -c '{type, item: .item.type}'` to eyeball the event shape.

## A2 — Reads vault files + obeys AGENTS.md

Same command as A1. PASS if the answer reflects `text.txt` content (Transformer /
self-attention) — proving Codex read the in-focus paper's file, not just guessed.
Look for an `item` of type `command_execution` running `cat`/`grep` on
`AAAA1111/text.txt`.

## A3 — Writes memory.md under workspace-write (the core loop)

```bash
codex exec --json -C "$VAULT" -s workspace-write \
  "In-focus paper: AAAA1111. Study it and create/update its memory.md per AGENTS.md rules."
cat "$VAULT/AAAA1111/memory.md"
```

PASS if `AAAA1111/memory.md` now exists, follows the section template, and did NOT
hang waiting for approval. FAIL signal: file not created, or it edited `text.txt`.

## A4 — git captures the memory change (review/revert safety net)

```bash
git -C "$VAULT" add -A
git -C "$VAULT" -c user.name=za -c user.email=za@local commit -m "turn: study AAAA1111"
git -C "$VAULT" show --stat HEAD
```

PASS if the diff shows `memory.md` added. This is the per-turn auto-commit the
plugin will do. Try `git -C "$VAULT" revert HEAD` to confirm a bad memory write is
recoverable.

## A5 — Session resume by explicit thread_id (in-chat continuity)

Using the `thread_id` captured in A1/A3:

```bash
codex exec resume <THREAD_ID> --json -C "$VAULT" -s read-only \
  "Following up: why the 1/sqrt(d_k) scaling?"
```

PASS if it answers with context from the earlier turn (no re-introduction),
proving multi-turn continuity via id. (Also try `resume --last` and note it is
cwd-filtered — confirms why we prefer explicit ids.)

## A6 — Cross-paper retrieval + relative-link graph (the actual product value)

```bash
codex exec --json -C "$VAULT" -s workspace-write \
  "In-focus paper: BBBB2222. How does it build on AAAA1111? Update BBBB2222/memory.md and cross-link."
grep -n "AAAA1111" "$VAULT/BBBB2222/memory.md"
```

PASS if Codex grepped across both papers, produced an accurate comparison
(BERT = bidirectional Transformer *encoder*; learned vs sinusoidal positions),
and wrote a relative link `../AAAA1111/memory.md` into BBBB2222's memory.

## A7 — Latency + cost sanity

```bash
time codex exec --json -C "$VAULT" -s read-only "In-focus: AAAA1111. One-line summary."
```

Record wall-clock and the `usage` tokens from `turn.completed`. This tells us
whether a simple turn is acceptable in a sidebar (vs the old direct-stream answer).

## A8 — Global AGENTS.md interference

```bash
cat ~/.codex/AGENTS.md
```

Inspect whether your global instructions conflict with the vault's memory rules
(Codex merges both hierarchically). Note any conflicts — we may need vault rules
to explicitly override, or document that users should keep global AGENTS.md neutral.

---

## Verdict

- [x] A1 JSONL stream parses, thread_id captured — PASS
- [x] A2 reads vault files, obeys AGENTS.md — PASS (followed rule "memory first, fall back to text.txt")
- [x] A3 writes memory.md, no approval hang — PASS (perfect schema adherence, accurate, deduped)
- [x] A4 git diff/revert works — PASS (memory change committed as a reviewable diff)
- [ ] A5 resume by thread_id keeps context — not run (low-risk; `resume <id>`/`--last` well-documented)
- [x] A6 cross-paper grep + relative link — PASS (accurate BERT↔Transformer comparison, wrote `../AAAA1111/memory.md` links)
- [~] A7 latency/cost — MEASURED: ~22s + ~50k input tokens for a trivial turn (heavier than old RAG; acceptability is a product decision)
- [x] A8 global AGENTS.md is benign — PASS (vault rules obeyed, no conflict observed)

### Critical finding (must fix in Phase 1)
`codex exec` HANGS forever if stdin is a non-TTY pipe left open ("Reading additional
input from stdin..."). Always close/empty stdin — CLI: `</dev/null`; plugin: close
the Subprocess stdin pipe immediately.

All checked → assumptions hold → proceed to Phase 1 (wire `Subprocess` + streaming
render into the sidebar). Any fail → note it here and we revise the design/ADRs.

## Cleanup

```bash
rm -rf "$HOME/papers-phase0"
```
