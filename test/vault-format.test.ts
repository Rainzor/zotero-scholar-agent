import { describe, expect, it } from "vitest";
import {
  appendMarkdownBlock,
  buildPaperRecordProjection,
  buildConversationTurnMarkdown,
  buildPaperVaultPaths,
  buildReadmeTable,
  buildTextMeta,
  escapeTable,
  formatWorkerTextForVault,
  hasPageEvidenceMarkers,
  inferTextMetaFromContent,
  initialMemoryMarkdown,
  joinPathParts,
  mergeReadmeEntries,
  normalizeVaultPath,
  normalizeTextMeta,
  parseSemanticRelationships,
  parseReadmePaperRows,
  replaceMarkedBlock,
  safePathSegment,
  shouldAttemptTextParserMigration,
  shouldReplaceTextWithPageMarkedVersion,
  TEXT_PARSER_VERSION,
  unescapeTable,
} from "../src/services/codex/vault-format";

describe("path helpers", () => {
  it("sanitizes path segments", () => {
    expect(safePathSegment("PXW99EKT")).toBe("PXW99EKT");
    expect(safePathSegment("chat/../evil")).toBe("chat_.._evil");
    expect(safePathSegment("")).toBe("unknown");
  });

  it("joins and normalizes vault paths", () => {
    expect(joinPathParts("/Users/me", "papers", "KEY")).toBe(
      "/Users/me/papers/KEY",
    );
    expect(normalizeVaultPath("~", "/Users/me")).toBe("/Users/me");
    expect(normalizeVaultPath("~/papers", "/Users/me")).toBe(
      "/Users/me/papers",
    );
    expect(normalizeVaultPath("~/papers", "")).toBe("");
    expect(normalizeVaultPath("/abs/path")).toBe("/abs/path");
  });

  it("builds paper vault relative paths", () => {
    const paths = buildPaperVaultPaths("/vault", "PXW99EKT");
    expect(paths.paperDir).toBe("/vault/PXW99EKT");
    expect(paths.textPath).toBe("/vault/PXW99EKT/text.txt");
    expect(paths.textMetaPath).toBe("/vault/PXW99EKT/text.meta.json");
    expect(paths.memoryPath).toBe("/vault/PXW99EKT/memory.md");
    expect(paths.recordPath).toBe("/vault/PXW99EKT/record.json");
    expect(paths.conversationsDir).toBe("/vault/PXW99EKT/conversations");
    expect(paths.conversationPath("chat-1")).toBe(
      "/vault/PXW99EKT/conversations/chat-1.md",
    );
  });
});

describe("markdown / README helpers", () => {
  it("escapes and unescapes table cells", () => {
    expect(escapeTable("a|b\nc")).toBe("a\\|b c");
    expect(unescapeTable("a\\|b")).toBe("a|b");
  });

  it("builds initial memory with default sections", () => {
    const md = initialMemoryMarkdown({
      itemId: 1,
      itemKey: "AAAA1111",
      title: "Attention Is All You Need",
      creators: "Vaswani et al.",
      year: "2017",
    });
    expect(md).toContain("# Attention Is All You Need (Vaswani et al., 2017)");
    expect(md).toContain("> itemKey: AAAA1111");
    expect(md).toContain("## Abstract");
    expect(md).toContain("## Contribution");
    expect(md).toContain("## Method");
    expect(md).toContain("## Insight");
    expect(md).toContain("## Library Connections");
    expect(md).toContain("### Semantic Relationships");
    expect(md).toContain("## Evidence Pointers");
  });

  it("parses semantic relationship lines for the structured projection", () => {
    const relationships = parseSemanticRelationships(
      [
        "### Semantic Relationships",
        "- [extends] [Paper B](../BBBB2222/memory.md): improves the sparse attention pattern. Evidence: [page 4]",
        "- [unknown] [Paper C](../CCCC3333/memory.md): ignored.",
        "- [supports] [Paper D](../DDDD4444/memory.md): similar result.",
      ].join("\n"),
      "AAAA1111",
      "2026-07-09T00:00:00.000Z",
    );
    expect(relationships).toEqual([
      {
        sourceItemKey: "AAAA1111",
        targetItemKey: "BBBB2222",
        type: "extends",
        rationale: "improves the sparse attention pattern.",
        evidence: "[page 4]",
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
      {
        sourceItemKey: "AAAA1111",
        targetItemKey: "DDDD4444",
        type: "supports",
        rationale: "similar result.",
        evidence: undefined,
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
    ]);
  });

  it("builds a generated paper record projection", () => {
    const projection = buildPaperRecordProjection({
      meta: {
        itemId: 1,
        itemKey: "AAAA1111",
        title: "Paper A",
        creators: "Alice",
        year: "2024",
      },
      memoryMarkdown:
        "- [can_combine_with] [Paper B](../BBBB2222/memory.md): complementary retrieval step.",
      generatedAt: "2026-07-09T00:00:00.000Z",
    });
    expect(projection.schemaVersion).toBe(1);
    expect(projection.itemKey).toBe("AAAA1111");
    expect(projection.relationships).toHaveLength(1);
    expect(projection.relationships[0].type).toBe("can_combine_with");
  });

  it("formats conversation turns and appends blocks", () => {
    const block = buildConversationTurnMarkdown({
      userMessage: "What is attention?",
      assistantMessage: "A weighting over keys.",
      timestamp: "2026-07-09T00:00:00.000Z",
      codexThreadId: "thread_1",
    });
    expect(block).toContain("## 2026-07-09T00:00:00.000Z · thread_1");
    expect(block).toContain("**You:**");
    expect(block).toContain("What is attention?");
    expect(appendMarkdownBlock("", block)).toBe(block);
    expect(appendMarkdownBlock("prev", "next")).toBe("prev\n\nnext");
  });

  it("parses and rebuilds README paper rows", () => {
    const table = buildReadmeTable([
      {
        itemId: 0,
        itemKey: "AAAA1111",
        title: "Paper A",
        creators: "Alice",
        year: "2020",
      },
    ]);
    const rows = parseReadmePaperRows(table);
    expect(rows).toEqual([
      {
        itemId: 0,
        itemKey: "AAAA1111",
        title: "Paper A",
        creators: "Alice",
        year: "2020",
      },
    ]);

    const merged = mergeReadmeEntries(table, {
      itemId: 2,
      itemKey: "BBBB2222",
      title: "Paper B",
      creators: "Bob",
      year: "2021",
    });
    expect(merged.map((r) => r.itemKey)).toEqual(["AAAA1111", "BBBB2222"]);
  });

  it("replaces marked README blocks", () => {
    const start = "<!-- start -->";
    const end = "<!-- end -->";
    const text = `header\n${start}\nold\n${end}\nfooter`;
    expect(replaceMarkedBlock(text, start, end, `${start}\nnew\n${end}`)).toBe(
      `header\n${start}\nnew\n${end}\nfooter`,
    );
  });

  it("formats PDFWorker form-feed text with page markers", () => {
    expect(formatWorkerTextForVault(" page one \f page two \f\f page three ")).toBe(
      "[page 1]\npage one\n\n[page 2]\npage two\n\n[page 4]\npage three",
    );
  });

  it("preserves page numbers when PDFWorker text starts with a form-feed", () => {
    expect(formatWorkerTextForVault("\fsecond page\fthird page")).toBe(
      "[page 2]\nsecond page\n\n[page 3]\nthird page",
    );
  });

  it("keeps PDFWorker text unchanged when no form-feed is present", () => {
    expect(formatWorkerTextForVault(" plain worker text ")).toBe(
      "plain worker text",
    );
  });

  it("detects page evidence markers", () => {
    expect(hasPageEvidenceMarkers("[page 1]\ntext")).toBe(true);
    expect(hasPageEvidenceMarkers("[page 0]\ntext")).toBe(false);
    expect(hasPageEvidenceMarkers("page 1\ntext")).toBe(false);
  });

  it("only replaces existing text when candidate adds page markers", () => {
    expect(
      shouldReplaceTextWithPageMarkedVersion(
        "plain text",
        "[page 1]\nplain text",
      ),
    ).toBe(true);
    expect(
      shouldReplaceTextWithPageMarkedVersion(
        "[page 1]\nplain text",
        "[page 1]\nplain text",
      ),
    ).toBe(false);
    expect(
      shouldReplaceTextWithPageMarkedVersion("plain text", "new plain text"),
    ).toBe(false);
  });

  it("builds text parser metadata", () => {
    expect(
      buildTextMeta({
        text: "[page 1]\nhello",
        source: "pdfworker-formfeed",
        generatedAt: "2026-07-10T00:00:00.000Z",
      }),
    ).toEqual({
      textParserVersion: TEXT_PARSER_VERSION,
      generatedAt: "2026-07-10T00:00:00.000Z",
      source: "pdfworker-formfeed",
      hasPageMarkers: true,
    });
  });

  it("infers old text metadata from existing content", () => {
    expect(
      inferTextMetaFromContent("plain text", "2026-07-10T00:00:00.000Z"),
    ).toMatchObject({
      textParserVersion: 1,
      source: "inferred",
      hasPageMarkers: false,
    });
    expect(
      inferTextMetaFromContent("[page 1]\ntext", "2026-07-10T00:00:00.000Z"),
    ).toMatchObject({
      textParserVersion: TEXT_PARSER_VERSION,
      hasPageMarkers: true,
    });
  });

  it("normalizes invalid text metadata with content fallback", () => {
    expect(
      normalizeTextMeta(
        { textParserVersion: "bad", source: "bad" },
        "[page 1]\ntext",
        "2026-07-10T00:00:00.000Z",
      ),
    ).toMatchObject({
      textParserVersion: TEXT_PARSER_VERSION,
      source: "inferred",
      hasPageMarkers: true,
    });
  });

  it("suppresses repeated parser migrations after an attempted version", () => {
    expect(
      shouldAttemptTextParserMigration({
        textParserVersion: 1,
        generatedAt: "2026-07-10T00:00:00.000Z",
        source: "inferred",
        hasPageMarkers: false,
      }),
    ).toBe(true);
    expect(
      shouldAttemptTextParserMigration({
        textParserVersion: 1,
        generatedAt: "2026-07-10T00:00:00.000Z",
        source: "inferred",
        hasPageMarkers: false,
        attemptedTextParserVersion: TEXT_PARSER_VERSION,
      }),
    ).toBe(false);
  });
});
