# Page Evidence and Context Dogfooding Benchmark

Use this note when validating page evidence chips and context cost in real Zotero sessions. Automated checks establish logic-level confidence; a human performs all Zotero clicks, sends prompts, verifies page jumps, and supplies screenshots. Do not mark a manual row as passed from unit-test evidence alone.

## Run metadata

Record the exact runtime before testing so results remain attributable:

| Field                          | Value                                                                    |
| ------------------------------ | ------------------------------------------------------------------------ |
| Date / timezone                | 2026-07-10 / Asia/Shanghai (+08:00)                                      |
| Git commit                     | `1434cea` + benchmark worktree                                           |
| Installed XPI build time       | 2026-07-10 15:15:42 +0800                                                |
| Page-notice fix build          | 2026-07-10 18:07:39 +0800; manually installed and verified               |
| Usage-semantics fix build      | 2026-07-10 18:22:00 +0800; awaiting manual installation                  |
| Zotero version                 | 9.0.6                                                                    |
| Codex CLI version              | 0.144.1                                                                  |
| Normal model                   | `gpt-5.5` configured; P1 turns resolved as `gpt-5.6-sol`                 |
| Cheap/digest model             | `deepseek-v4-pro-thinking` configured; P1 source `codex-cheap`           |
| Context-window source and size | 372k raw / 353.4k effective model metadata; active occupancy unavailable |

## Paper sample

Choose 3–5 real papers. Use at least one short paper, one long or dense paper, and one paper with an existing non-empty Knowledge Surface. Create a dedicated benchmark chat session for each paper so the test does not contaminate normal research conversations.

| Sample        | Paper / Item Key                                                              | Pages | Knowledge Surface before run | Why selected                                       |
| ------------- | ----------------------------------------------------------------------------- | ----: | ---------------------------- | -------------------------------------------------- |
| P1            | CausVid: From Slow Bidirectional to Fast Causal Video Generators / `4DUGF5FU` |    17 | populated                    | Current-schema Knowledge Surface; page-marked text |
| P2            |                                                                               |       | empty / populated            |                                                    |
| P3            |                                                                               |       | empty / populated            |                                                    |
| P4 (optional) |                                                                               |       | empty / populated            |                                                    |
| P5 (optional) |                                                                               |       | empty / populated            |                                                    |

## Page Evidence Validation

For every manual row, capture a screenshot containing the assistant message/chip state. For jump rows, record the PDF page visible before and after clicking. One screenshot may support multiple formatting-isolation rows when all states are visible.

| ID  | Scenario                                       | Non-click evidence                                           | Human action and expected result                                                                              | Result | Screenshot / notes                                                                                                                                               |
| --- | ---------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Assistant answer contains `[page 1]`           | Parser maps to page index 0                                  | Click chip; PDF moves to first page                                                                           | PASS   | P1 Fresh screenshot shows clicked `p.1` and Reader at `1 / 17`                                                                                                   |
| E2  | Assistant answer contains `[page 2]`           | Parser maps to page index 1                                  | Click chip; PDF moves to second page with no off-by-one error                                                 | PASS   | P1 screenshot shows clicked `p.2` and Reader at `2 / 17`; no off-by-one error                                                                                    |
| E3  | `[page N]` inside fenced code                  | Renderer skip rule exists                                    | Confirm marker remains plain code text, not a chip                                                            | PASS   | Screenshot shows `[page 3]` preserved inside fenced code                                                                                                         |
| E4  | `[page N]` inside inline code                  | Renderer skip rule exists                                    | Confirm marker remains inline code text                                                                       | PASS   | Screenshot shows inline `[page 4]` preserved as code                                                                                                             |
| E5  | `[page N]` inside link text                    | Renderer skip rule exists                                    | Confirm marker remains link text and link behavior is unchanged                                               | PASS   | Screenshot shows `[page 5]` remains a normal link, not a page chip                                                                                               |
| E6  | Reader closed/unavailable                      | `no-reader` state is unit-tested                             | Close/switch away from Reader; chip is disabled or reports failure without throwing                           |        |                                                                                                                                                                  |
| E7  | Page out of range                              | `out-of-range` state is unit-tested                          | Use `[page 9999]`; chip is disabled and does not navigate                                                     | PASS   | `p.9999` reports “outside this PDF (17 pages)” without navigation; infinite notice animation found during dogfood, fixed in 18:07:39 build and manually verified |
| E8  | Disabled chip, then open the PDF Reader        | Click handler re-evaluates state                             | Reopen the correct PDF and click the previously disabled chip; it recovers and jumps                          |        |                                                                                                                                                                  |
| E9  | `Evidence: [page N]` in Knowledge review block | Relationship diff and page parser are unit-tested separately | Create a valid new Semantic Relationship; its Evidence marker renders as a clickable chip and jumps correctly |        |                                                                                                                                                                  |

### Fixed evidence prompts

Use these prompts in a dedicated test session. Keep the wording unchanged across papers unless the paper genuinely lacks the requested evidence.

**Grounded page prompt (E1/E2):**

```text
用两点说明这篇论文的核心问题和主要方法。每一点都必须引用你从 text.txt 核对过的证据，使用精确格式 [page N]。至少包含一个第 1 页或第 2 页的有效引用；不要猜页码。
```

**Formatting and range prompt (E3/E4/E5/E7):**

````text
这是 UI benchmark。回答完一个简短的论文事实后，请在末尾原样输出以下四项，不要改写：

```text
[page 3]
```

行内代码 `[page 4]`

链接 [[page 5]](https://example.invalid/page-test)

越界标记 [page 9999]
````

**Relationship review prompt (E9):**

```text
比较当前论文与我通过 @ 明确提及的论文。如果证据支持一个持久关系，只更新当前论文 memory.md 的 Semantic Relationships，严格使用项目规定的关系行格式，并包含 Evidence: [page N]。不要修改被提及论文。
```

E6/E8 require the same valid chip from E1 or E2. Do not generate another answer between closing and reopening the Reader.

## Token and latency protocol

Measure from the human pressing **Send** until the final assistant answer and turn footer are visible. Record seconds to one decimal place. Copy `turn.completed.usage` from the sidebar footer; do not estimate token counts from message text. `input_tokens` is cumulative work across model calls in that turn, not active context occupancy. Use it as a cost/efficiency metric; do not divide it by the model context window.

Run all three paths on each of at least three papers:

1. **Fresh:** create a new benchmark session and send the grounded page prompt.
2. **Resume:** in the same session, ask the fixed follow-up below without compacting.
3. **Digest:** after enough visible turns exist, manually compact, confirm the session shows a saved Context Digest and a cleared/replaced thread, then send the fixed continuation prompt.

**Resume follow-up:**

```text
基于你上一轮的回答，指出一个最重要的局限，并说明它如何影响结果解释。保留上一轮使用的术语，并给出 [page N] 证据。
```

Before compacting, establish three continuation anchors in the visible session: a named method, one result/limitation, and one unresolved reader question.

**Digest continuation:**

```text
继续我们压缩前的讨论：复述已经确定的方法名和局限，然后回答当时未解决的 reader question。请指出哪些信息来自保留的上下文，哪些需要重新查看论文，并为论文事实给出 [page N]。
```

If a path fails, preserve the failed row and add a separate rerun row.

| Date       | Sample | Paper / Item Key | Path                   | Wall-clock (s) | Input tokens | Cached input | Output tokens | Model / window metadata                    | Activities: memory/text               | Result / notes                                                                                   |
| ---------- | ------ | ---------------- | ---------------------- | -------------: | -----------: | -----------: | ------------: | ------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 2026-07-10 | P1     | `4DUGF5FU`       | fresh thread           |            ≈60 |      103,132 |       76,800 |           872 | `gpt-5.6-sol`; 372k raw / 353.4k effective | M→T confirmed by expanded activity    | PASS response; reasoning 311; one page-boundary command failed, then recovered successfully      |
| 2026-07-10 | P1     | `4DUGF5FU`       | resume existing thread |            ≈60 |       75,552 |       52,480 |           622 | `gpt-5.6-sol`; 372k raw / 353.4k effective | M→T confirmed by expanded activity    | PASS response; reasoning 145; prior visible turn confirms resume path; page chips rendered       |
| 2026-07-10 | P1     | `4DUGF5FU`       | digest fresh thread    |                |      156,139 |      123,648 |         2,488 | `gpt-5.6-sol`; 372k raw / 353.4k effective | M→T confirmed from persisted activity | PASS response; reasoning 636; cheap-model digest covered messages 0..5 before fresh continuation |
|            | P2     |                  | fresh thread           |                |              |              |               |                                            |                                       |                                                                                                  |
|            | P2     |                  | resume existing thread |                |              |              |               |                                            |                                       |                                                                                                  |
|            | P2     |                  | digest fresh thread    |                |              |              |               |                                            |                                       |                                                                                                  |
|            | P3     |                  | fresh thread           |                |              |              |               |                                            |                                       |                                                                                                  |
|            | P3     |                  | resume existing thread |                |              |              |               |                                            |                                       |                                                                                                  |
|            | P3     |                  | digest fresh thread    |                |              |              |               |                                            |                                       |                                                                                                  |

For optional P4/P5, append the same three rows.

### Cost decision

After at least nine valid samples, report median and range per path. The Layered Context cost target passes only when the median simple-turn input tokens are less than half of the approximately 50k Phase-0 baseline. Report fresh, resume, and digest separately; do not hide regressions inside one combined average.

## Context Digest Quality Samples

Use at least two long sessions. Compact the session, continue in a fresh thread, then judge whether the answer preserves the needed task state.

Score each anchor as `2 = preserved accurately`, `1 = partial/ambiguous`, or `0 = missing/wrong`. A sample passes at 5/6 or better with no invented decision or constraint.

| Date       | Paper / Item Key | Digest source                               | Method anchor /2 | Result or limitation /2 | Open question /2 | Total /6 | Re-read paper?                                  | Missing/invented context                                                                                                               | Screenshot / notes                                   |
| ---------- | ---------------- | ------------------------------------------- | ---------------: | ----------------------: | ---------------: | -------: | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 2026-07-10 | `4DUGF5FU`       | codex-cheap                                 |                2 |                       2 |                2 |        6 | Yes, after first restating all retained anchors | None; all named method and limitation anchors were preserved, and the open attribution question was resolved with explicit uncertainty | Digest covered messages 0..5; estimated 1,298 tokens |
|            |                  | codex-cheap / codex-default / deterministic |                  |                         |                  |          |                                                 |                                                                                                                                        |                                                      |

## Non-click verification record

Record the command, commit, and result whenever logic-level tests are run. These checks support E1–E9 but do not replace the human Zotero evidence.

| Date       | Commit               | Command                                                                                                                   | Result       | Scope                                                                                               |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| 2026-07-10 | `1434cea` + worktree | `npm test -- --run test/page-evidence.test.ts test/page-jump.test.ts`                                                     | PASS — 13/13 | Marker parsing, page indexing, unavailable/out-of-range state, and state recovery                   |
| 2026-07-10 | `1434cea` + worktree | `npm test -- --run test/research-turn-prompt.test.ts test/context-digest.test.ts test/research-turn-orchestrator.test.ts` | PASS — 17/17 | Fresh/resume/digest prompts, compaction fallback, and resume fallback                               |
| 2026-07-10 | `1434cea` + worktree | `npm test -- --run test/agent-status.test.ts test/page-jump.test.ts test/page-evidence.test.ts`                           | PASS — 15/15 | Static completed-action notices plus page evidence/jump regression coverage                         |
| 2026-07-10 | `1434cea` + worktree | `npm test -- --run test/codex-context-window.test.ts test/context-digest.test.ts test/token-usage.test.ts`                | PASS — 16/16 | Cumulative turn usage is not converted into active context occupancy; manual digest remains covered |

## Final decision

Do not close the two roadmap items until:

- all nine page-evidence scenarios have human evidence and pass;
- at least three real papers have valid fresh/resume/digest measurements;
- at least two digest samples pass the 5/6 quality threshold;
- the token/latency medians and ranges are reported without omitted failures.

Decision: **Pending manual Zotero run.**
