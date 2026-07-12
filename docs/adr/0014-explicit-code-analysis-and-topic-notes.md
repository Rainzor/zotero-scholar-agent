---
status: accepted
---

# Explicit code analysis and Topic Notes

## Context

The Knowledge Vault needs to support reproduction-level reading and durable
cross-paper synthesis without turning external repositories or generated
surveys into competing sources of truth. ADR 0012 reserves L3 for
user-initiated code work, while the roadmap requires field-level artifacts to
live above individual Paper Directories.

## Decision

- Source-code analysis starts only from a user-confirmed GitHub repository URL.
  The plugin deterministically clones or fast-forwards a shallow checkout into
  `{itemKey}/code/`, records the branch and commit in a plugin-owned block in
  `code-notes.md`, and checks for source modifications after Codex analysis.
- The checkout is gitignored and is not part of Vault knowledge history.
  `code-notes.md` is tracked and is the durable L3 interpretation artifact.
- Topic Notes are created only from an explicit selection of at least two
  Paper Knowledge Records. They live at `topics/{slug}.md`; plugin-owned YAML
  records the selected Item Keys, while Codex rewrites only the synthesis body.
- Neither workflow silently changes another paper. Automatic repository
  discovery, automatic Topic Note maintenance, code execution experiments, and
  Living Surveys remain separate future work.

## Consequences

- Code provenance is reproducible without committing third-party source trees.
- Topic synthesis remains reviewable and tied to stable Item Keys.
- Network or Codex failures do not corrupt the existing Knowledge Surface.
- The Vault remains the single source of truth.
