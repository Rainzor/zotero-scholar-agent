# Memory Design Philosophy - Core Conventions for the Knowledge Vault

> Track: backend
> Status: Living document. This document explains why the memory system is designed this way
> and provides the philosophical basis for the roadmap and future ADRs.
> Terminology follows `CONTEXT.md`: Knowledge Vault, Paper Knowledge Record, Knowledge
> Surface, Structured Projection, Reader Thinking, and Semantic Relationship.
> Concrete architectural decisions are governed by `docs/adr/`; differences between this
> document and the current implementation are explicitly marked in Section 5.

## 0. Core Thesis

**What the memory system ultimately records is not the paper, but the evolving relationship
between the researcher and the literature.**

The paper itself will always remain in the PDF and cannot be lost. What can be lost is why I
read it, how much I trusted it, what ideas it changed for me, and how it connects to other
papers I have read. Everything in the Knowledge Vault exists to preserve the latter. This
leads to two independent axes. Every paper note sits at the intersection of these axes:

- **Depth of engagement**: How much attention is this paper worth investing (one sentence ->
  skim -> close reading -> reproduction)?
- **Type of value**: What form does this paper's value take for me (method/theory
  advancement, transferable insight, or a key to understanding the methodology and canonical
  language of the field)?

Treating every paper with one uniform template denies both axes. Ordinary papers become
hundreds of lines long (wasting effort and polluting cross-paper retrieval), while important
papers have no path to become more detailed.

## 1. First Principles

### P1 - Note length should be proportional to marginal value, not paper length

Engagement depth has four levels and is **dynamically adjustable**. New papers enter the vault
at the cheapest level by default:

| Level | Positioning             | Form                                                                                               | Trigger                                                                          |
| ----- | ----------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| L0    | One-sentence paper note | A 5-line card: conclusion + why more attention is not justified + pointer to more important papers | User downgrade or cold-start judgment                                            |
| L1    | Standard skim (default) | TL;DR + Contribution + Method skeleton + Takeaways                                                 | Cold-start default                                                               |
| L2    | Close reading           | Full Knowledge Surface template, with page anchors on key statements                               | Agent proposes after enough depth has accumulated in conversation; user confirms |
| L3    | Reproduction-level      | L2 + source-code reading notes + hands-on experiment records                                       | User explicitly initiates                                                        |

An upgrade rewrites the note rather than appending to it. A downgrade compresses the content
into an L0 card; history remains in git. **Determining that a paper is mediocre is itself a
research result.** An L0 card such as "A minor variant of X; see [[X]]; no new evidence"
saves the future self from reading the paper again. That is the value of negative knowledge.

### P2 - Value type and engagement depth are independent

A methodologically mediocre paper may contain an excellent transferable insight. A
foundational paper may only require one of its definitional statements. Value type
(`method-advance` / `transferable-insight` / `methodology` / `canon`) enters the Structured
Projection as a signal label and routes retrieval. Questions about method details should
preferentially retrieve L2/L3 papers; questions about "what the field is doing" should
preferentially retrieve field-level notes.

### P3 - Put deterministic work in code and interpretation in the model

Anything that can be completed deterministically must not depend on the model remembering to do
it: bibliographic metadata, the original abstract, tag synchronization, timestamps, tier
fields, format validation, and anchor indexes. The model's responsibility should be limited to
what only it can do: understanding, critique, insight, and relationship discovery.
**Rules that depend on the model voluntarily following them will inevitably drift.** This has
been repeatedly confirmed by early Vault practice. A quality checker that can detect problems
is only the starting point; every detection result must have an action path, such as injection
into the next repair turn or a UI action, so that the system forms a closed loop.

### P4 - Divide files by write discipline, not by content topic

Each file should have exactly one write discipline and one maintainer. This is the only
criterion needed to decide whether to split a file:

| Discipline                                | Carrier                                                                    | Maintainer  |
| ----------------------------------------- | -------------------------------------------------------------------------- | ----------- |
| Read-only, deterministic                  | `text.txt`; the plugin-marked block in `memory.md` (bibliography/abstract) | Plugin      |
| Rewrite + deduplicate                     | Interpretation area of `memory.md` (Contribution...Library Connections)    | Model       |
| Append-only, preserve wording exactly     | `notes.md` (the carrier for Reader Thinking); `conversations/`             | User/plugin |
| Purely generated, manual edits prohibited | `record.json`                                                              | Plugin      |

Splitting by topic (`method.md`, `results.md`, and so on) is the wrong boundary. It fragments
the same write discipline, increases the number of rules, and damages human readability and
the coherence of git diffs. Derivable content, such as a page-anchor index, should not have a
manually maintained section. The plugin should extract it from inline anchors into the
Structured Projection.

### P5 - Make source and trust visible in the structure

The credibility of individual statements in a note varies greatly: something reproduced by
hand is not the same as something claimed by the paper, which is not the same as something
inferred by the agent. A researcher's core skill is maintaining the correct level of trust in
each piece of knowledge, so the system must make that trust visible:

- Separate Paper-grounded Knowledge and Reader Thinking by **file boundary** (`memory.md` vs.
  `notes.md`), rather than relying on the model to label them correctly within one file.
  Structural guarantees are stronger than rule-based requirements.
- Entries in `notes.md` include a date and author (`[user]` / `[agent, user-confirmed]`).
  Changes in judgment remain visible, such as "I now consider this paper important because
  ...". **The trajectory of changing beliefs is rarer than any individual belief.**
- Key conclusion sections (Results, Insight) distinguish `[claimed by paper]` from
  `[verified]`. The labeling system is intentionally minimal; the larger it becomes, the
  more likely it is to drift.
- Knowledge decays at different rates. SOTA numbers may become outdated within months, while
  problem definitions barely decay. Mark conclusions superseded by new work with
  `[superseded by [[KEY]]]` instead of deleting them, preserving their lineage.

### P6 - Trigger relationship discovery proactively

Semantic Relationship is the product's most differentiated value for researchers. However, a
mechanism that only writes a relationship when an answer happens to establish one will leave
the relationship layer permanently empty. After generating a Knowledge Surface during
cold-start, the system must run a linking pass that proactively proposes candidate
relationships against existing `*/memory.md` files. Field-level survey notes in the `fields`
layer should be created only after relationships accumulate past a critical mass.

### P7 - Use anti-overengineering as the litmus test

Every new structure must answer: **Does it change how the future self will retrieve or trust
this note?** If it merely makes the note "more complete", do not add it. Once the target
single-paper structure in Section 3 is reached, freeze it. Each paper should have exactly two
human-maintained files; everything else should be generated or derived. Future extensions
(`insights` layer, `fields` layer, entity indexes) belong at the Vault level and should not
increase the complexity of individual paper directories.

## 2. Dimensions Considered and Their Destinations

The following dimensions emerged during the design process and were narrowed by the P7
litmus test. This prevents the same discussions from recurring:

- **Adopted**: Cognitive-state labels (P5), superseded markers (P5), reading intent
  `readingContext` and Actions (in `notes.md`), and the fixed question "What expectation did
  this paper change for me?" (nearly zero cost while serving both tier classification and
  insight extraction).
- **Handled by existing mechanisms**: Negative knowledge (a natural extension of L0 cards),
  problem/dataset/benchmark entity indexes (controlled-vocabulary fields in `record.json`,
  without creating directories), and versioning of understanding (git provides this for free;
  only the rule "do not delete changes in viewpoint" is needed).
- **Explicitly not built as separate systems**: Author/school layers (a section in future
  field notes; personal information decays quickly and costs too much to maintain), and any
  complex annotation system that requires the model to maintain it continuously by itself.

## 3. Target Shape of a Single Paper Directory

```text
{itemKey}/
├── text.txt              # Full-text extraction with [page N] markers. Plugin-written, read-only
├── text.meta.json         # Parser version stamp. Plugin-written
├── memory.md             # Knowledge Surface: "what the paper says". Model rewrite+dedupe
│   ├── frontmatter       #   tier/rating/zoteroTags/updatedAt - plugin-written
│   ├── plugin block      #   bibliography + Zotero abstract - maintained by replaceMarkedBlock; model reads only
│   └── interpretation    #   Tier-specific template; key statements carry inline [page N] anchors
├── notes.md              # Reader Thinking: "how I think about it". Append-only, wording preserved exactly
│   ├── readingContext    #   Why I read it at the time
│   ├── thoughts/critique #   Dated and attributed entries, including changes in viewpoint
│   └── Actions            #   Follow-up tasks generated by this paper
├── record.json           # Structured Projection. Plugin-generated; manual edits prohibited
├── conversations/        # Conversation transcripts. Plugin append-only
└── (L3 only) code-notes.md # Repository pointers + paper-vs-code differences (the highest-value L3 output)
    experiments/          # One file per experiment: hypothesis -> setup -> result -> conclusion
```

The Vault-level `insights/` layer (atomic cross-paper insights) and `fields/` layer
(field-level surveys) are future layers. Their trigger conditions are defined in P6. At the
single-paper level, use inline `[-> insight candidate]` markers for content that may later be
harvested; do not create additional structure yet.

## 4. Implementation Priority

1. Inject the plugin-marked block (bibliography/abstract) and move Reader Thinking to
   `notes.md`; migrate existing data.
2. Add the `tier` field and L0/L1/L2 tiered templates; use hidden markers and UI confirmation
   for upgrades.
3. Close the quality-check loop (provide a repair path) and backfill missing `record.json`
   files.
4. Add the cold-start linking pass. Acceptance case: the relationship chain among
   LingBot-World 1.0/2.0/CausVid in the library.
5. Add the language policy to the Vault `AGENTS.md`: body text follows the user's language;
   terminology and canonical wording retain the original English (cross-language retrieval
   failures are a real defect).
6. Add the minimal cognitive labels (only in the Results/Insight sections).

## 5. Relationship to Existing ADRs

The philosophy in this document is consistent with and extends ADR-0002 (three-layer memory),
ADR-0003 (the Record/Surface/Projection triad), and ADR-0007 (Vault versioning and signal
frontmatter). The following proposals **change the current state** and require their own ADRs
before implementation:

- Move Reader Thinking from `memory.md` to `notes.md` (revise the file layout described by
  ADR-0002/0003. ADR-0002 already warns that a format change means migrating user memory;
  this requires a corresponding `vault.json` version upgrade).
- Remove the Evidence Pointers section and derive it from inline anchors in the plugin (revise
  the Knowledge Surface template).
- Add the `tier` field and tiered templates (extend the frontmatter schema in ADR-0007).
