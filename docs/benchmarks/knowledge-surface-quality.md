# Knowledge Surface Quality Benchmark

Use this rubric to evaluate whether `memory.md` is becoming a trustworthy Paper Knowledge Record rather than a growing chat summary. Run it before accepting cold-start, relationship, library-Q&A, or topic-level features.

## Scope and sampling

- Sample 3–5 real papers with different lengths and methods.
- Evaluate the current `memory.md`, the source paper abstract, and the git diff from at least three relevant turns.
- Evaluate only papers whose Knowledge Surface has already been initialized. Cold-start coverage is a separate product metric.
- Keep Paper-grounded Knowledge and Reader Thinking separate. Unsupported reader interpretation must not be scored as a paper claim.

## Acceptance gate

A Knowledge Surface passes when all of the following are true:

1. No critical failure is present.
2. Total score is at least **80/100**.
3. Tier-template completeness is at least **30/35**.
4. Abstract fidelity is at least **20/25**.
5. Semantic Relationship parse coverage is **100%**.

Critical failures:

- The Abstract invents or reverses a paper claim.
- Paper-grounded sections present Reader Thinking as if the paper claimed it.
- A relationship targets the wrong Item Key or asserts an unsupported contradiction/support relation.
- Three-turn review shows repeated blind appends that materially duplicate existing knowledge.

## Rubric

| Dimension                                | Weight | Full-credit rule                                                                                                                            | Partial / failure rule                                                                                                                         |
| ---------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier-template completeness               |     35 | Every section required by the record's declared tier contains concise, paper-specific knowledge                                             | Scale the required tier sections to 35 points; do not penalize L0/L1 for sections reserved for L2/L3                                           |
| Abstract fidelity                        |     25 | Original or near-original abstract is preserved; omissions are marked and no claim is invented                                              | 20 for faithful compression with no changed claim; 10 for approximate but clearly labelled; 0 for an invented or materially distorted abstract |
| Evolution without append bloat           |     20 | New learning is merged into the right section, duplicates are rewritten, and stale wording is corrected                                     | 10 when useful but mostly appended; 0 when repeated append-only turns create duplicates or contradictory statements                            |
| Semantic Relationship format and meaning |     10 | Every candidate relationship parses, uses an allowed type, targets an existing Item Key, explains why, and includes evidence when available | Deduct 2 per malformed/unsupported line; 0 if parse coverage is below 100%                                                                     |
| Grounding and knowledge boundary         |     10 | Paper claims have evidence pointers where needed; Reader Thinking is explicitly labelled; uncertainty is preserved                          | 5 when boundaries are mostly clear but evidence is sparse; 0 when interpretations are presented as paper facts                                 |

### Tier-template completeness checklist

- **L0:** Verdict, Why Stop Here, Better Pointers, Library Connections.
- **L1:** TL;DR, Contribution, Method, Takeaways, Library Connections.
- **L2/L3:** Contribution, Problem, Method, Insight, Results, Takeaways,
  Library Connections. L3 additionally requires a useful `code-notes.md`.
- Abstract is plugin-owned and scored only under Abstract fidelity.

A section is meaningful only when it answers its section question without generic filler:

| Section      | Required question                                                                |
| ------------ | -------------------------------------------------------------------------------- |
| Abstract     | What does the paper itself say it does, using original or near-original wording? |
| Contribution | What is new relative to prior work?                                              |
| Problem      | What concrete limitation or research problem is addressed?                       |
| Method       | What does the approach actually do?                                              |
| Insight      | Why should the method work or matter?                                            |
| Results      | What evidence supports the claims, including important limits?                   |
| Takeaways    | What should a researcher retain or reuse?                                        |

Do not award completeness for headings containing only placeholders such as `_Not yet distilled._`, `TBD`, or a restatement of the title.

### Abstract fidelity procedure

1. Obtain the Zotero metadata abstract or the abstract text from the first pages of `text.txt`.
2. Compare every claim-bearing sentence in `memory.md`'s Abstract with the source.
3. Mark each sentence `exact/near-original`, `faithful compression`, `unsupported`, or `contradicted`.
4. If the source abstract is unavailable, the section must say that it is missing or approximate; it cannot receive more than 10/25.

Record the source used. Do not silently substitute a Codex-generated summary for the paper's abstract.

### Append-bloat procedure

Review the last three relevant Vault commits for the paper:

```bash
git -C ~/papers log --oneline -- {ITEM_KEY}/memory.md
git -C ~/papers diff HEAD~3..HEAD -- {ITEM_KEY}/memory.md
```

Flag the sample when any of these hold:

- The same claim appears twice in one or more core sections.
- A new bullet paraphrases an existing bullet without adding evidence or qualification.
- New content is appended under the wrong section instead of rewriting the existing statement.
- A corrected claim leaves the stale claim in place.
- Across three overlapping turns, the file grows by more than 25% with no deletions or rewrites. This is a review trigger, not an automatic failure when the added knowledge is genuinely new.

### Relationship compliance procedure

Candidate relationship lines are bullets under `## Library Connections` / `### Semantic Relationships` that begin with a bracketed type. Each must follow:

```markdown
- [extends] [Paper title](../OTHERKEY/memory.md): rationale. Evidence: [page 4]
```

Allowed types are `cites`, `extends`, `contradicts`, `supports`, `uses_same_method`, `uses_same_dataset`, `uses_same_metric`, `solves_limitation_of`, `can_combine_with`, and `inspired_question`.

Calculate:

```text
Relationship parse coverage = parsed relationship lines / candidate relationship lines
```

The gate is 100%. Format compliance does not prove semantic correctness; manually verify the rationale, target Item Key, direction, and evidence.

When there are no candidate relationship lines, define parse coverage as 100% for the format gate. Do not invent a relationship merely to populate the section. Relationship semantic correctness still requires confirming that the absence of a relationship is reasonable for the sampled turns.

## Knowledge reuse rate

The metric answers: when a useful Paper Knowledge Record already exists, does Codex reuse it before reopening raw paper text?

### Eligible turns

Include conceptual questions, comparisons, follow-ups, and synthesis turns. Exclude:

- cold-start/initialization turns;
- explicit requests to quote or inspect a specific page, table, figure, or formula;
- turns where the needed fact is absent from the Knowledge Surface;
- operational requests unrelated to paper knowledge.

Classify each eligible turn from the visible Codex activity:

- **M-only:** reads/searches `memory.md` or `record.json`, does not read `text.txt`.
- **M→T:** reads memory first, then opens `text.txt` for missing evidence or detail.
- **T-first:** opens `text.txt` before consulting an existing Knowledge Surface.
- **No-read:** answers without reading either durable knowledge or raw text.

Calculate:

```text
Knowledge reuse rate = (M-only + M→T) / eligible turns
Memory-only rate     = M-only / eligible turns
Raw fallback rate    = (M→T + T-first) / eligible turns
```

Provisional acceptance targets, to be ratified after the first 3–5-paper dogfood run:

- Knowledge reuse rate ≥ 70% overall.
- Knowledge reuse rate ≥ 80% for conceptual follow-ups whose answer is already in `memory.md`.
- T-first rate ≤ 20%.
- No-read turns require manual grounding review and do not count as successful reuse.

Reading memory is necessary but not sufficient. Count an `M-only` or `M→T` turn as a successful reuse only when the answer actually uses relevant stored knowledge.

## Quality sample sheet

| Date | Paper / Item Key | Seven sections /35 | Abstract /25 | Evolution /20 | Relationships /10 | Grounding /10 | Total | Critical failure | Result | Reviewer notes |
| ---- | ---------------- | -----------------: | -----------: | ------------: | ----------------: | ------------: | ----: | ---------------- | ------ | -------------- |
|      |                  |                    |              |               |                   |               |       |                  |        |                |
|      |                  |                    |              |               |                   |               |       |                  |        |                |
|      |                  |                    |              |               |                   |               |       |                  |        |                |

## Knowledge reuse sample sheet

| Date | Paper / Item Key | Turn question | Eligible? | Activity class                   | Stored knowledge actually used? | Notes |
| ---- | ---------------- | ------------- | --------- | -------------------------------- | ------------------------------- | ----- |
|      |                  |               |           | M-only / M→T / T-first / No-read |                                 |       |
|      |                  |               |           | M-only / M→T / T-first / No-read |                                 |       |
|      |                  |               |           | M-only / M→T / T-first / No-read |                                 |       |

Report aggregate counts and all three rates beneath the completed table. Preserve failed samples; do not replace them with later successful reruns.

## Rubric calibration record

The initial read-only calibration used two existing local Vault artifacts without copying paper titles, Item Keys, or content into this repository:

- A current-schema Knowledge Surface exercised all seven headings, faithful Abstract preservation, section rewrites, and evidence boundaries; it fell in the passing range.
- A legacy-schema Knowledge Surface used `TL;DR`, `Key contributions`, and `Cross-references`; it failed the seven-section and Abstract gates even though its recent git history showed no duplicate-line append bloat.

This confirms that the rubric distinguishes schema/knowledge quality from simple file growth. These anonymous calibration artifacts do not satisfy the required 3–5-paper scored benchmark.
