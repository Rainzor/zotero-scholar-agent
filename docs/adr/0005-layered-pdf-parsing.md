---
status: accepted
track: both
---

# Layered PDF parsing: deterministic PDFWorker base, Codex-driven enrichment

## Context

The plugin writes each paper's `text.txt` deterministically via `Zotero.PDFWorker.getFullText`: form-feed page breaks become `[page N]` markers, and `text.meta.json` carries a parser-version stamp that drives one-time migration of stale extractions. This base layer is free, instant, reproducible, and available on every machine the plugin runs on — the Zotero runtime is the one dependency a Zotero plugin is guaranteed to have.

It also has three real gaps:

1. **Text-only.** Table structure, formulas, and figures are lost.
2. **Scanned PDFs hard-fail.** PDFWorker returns empty text and vault prep throws (`PDFWorker returned no text`) with no fallback.
3. **Layout heuristics.** Two-column reading order and trailing-reference trimming are best-effort.

The Codex CLI on this machine (0.144.1) ships a `pdf` skill at `~/.codex/skills/pdf`. Inspection shows it is **not a built-in parser** — it is a prompt-level workflow instructing the agent to shell out to Poppler (`pdftoppm` page rendering) and Python (`pdfplumber`/`pypdf`), installing them on the fly if missing.

We considered replacing plugin-side extraction with Codex-driven parsing to "reduce Zotero dependence". The premise is inverted: it would swap the one guaranteed dependency (PDFWorker) for a set of unguaranteed system dependencies (poppler, python3, pip packages), cost a Codex turn per paper, make `[page N]` markers non-reproducible (breaking page-evidence chips and parser-version migration), and require either copying PDFs into the Vault (violating the no-PDFs-in-Vault decision) or coupling Codex to Zotero's internal `storage/` layout.

## Decision

**PDFWorker deterministic extraction remains the only writer of `text.txt` on the default path.** Codex-driven PDF parsing is an **opt-in enrichment layer**, used only where the base layer cannot reach:

1. **Scanned-PDF fallback.** When PDFWorker returns empty text, vault prep no longer dead-ends: the UI offers an explicit "parse this PDF with Codex" action (opt-in, never automatic). The Codex-produced text is accepted as `text.txt` only after mechanical validation — page count matches the PDF, `[page N]` markers present and monotonic. Provenance is recorded via a distinct `parserSource` value in `text.meta.json`.
2. **Figure/table understanding** (roadmap §2.6). When a question needs visual detail, relevant pages are rendered on demand (`pdftoppm` → PNG) into `{itemKey}/figures/` and attached with `codex exec -i`. This complements — never replaces — user-initiated screenshots.
3. **Dependency detection and graceful degradation.** Enrichment paths probe for poppler/python availability first and surface an install hint when missing. The default reading path never depends on them.
4. **Vault boundary unchanged.** Original PDFs never enter the Vault. Enrichment invocations receive the PDF's Zotero storage path per-turn for read-only access; only derived artifacts (rendered PNGs, validated text) land in the Vault.

## Consequences

- Page-evidence chips and parser-version migration keep their determinism guarantee.
- Scanned papers gain a path into the knowledge system instead of a hard error.
- `text.meta.json` gains new `parserSource` values; consumers must not assume PDFWorker provenance.
- `{itemKey}/figures/` needs a git decision (lean: gitignore rendered pages as regenerable, keep user screenshots — finalize in the §2.6 design).
- The enrichment layer inherits whatever provider/model `~/.codex` is configured with; its cost is per-use and user-triggered, never library-wide.
- A future standalone (non-Zotero) generator CLI could replicate the base layer with poppler under the same parser-version protocol; that is a separate portability track, not a change to this architecture.
