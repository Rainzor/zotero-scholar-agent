import { describe, expect, it } from "vitest";
import {
  evaluateKnowledgeSurface,
  isUnbuiltSkeleton,
} from "../src/services/knowledge-quality";

const COMPLETE = `# Paper

## Abstract
Source abstract.

## Contribution
New contribution.

## Problem
Concrete problem.

## Method
Specific method.

## Insight
Grounded insight.

## Results
Measured result.

## Takeaways
Reusable takeaway.

## Reader Thinking

## Library Connections

### Semantic Relationships

## Evidence Pointers
`;

const L1_SKELETON = `# Paper

## TL;DR

## Contribution

## Method

## Takeaways

## Library Connections
`;

describe("evaluateKnowledgeSurface", () => {
  it("passes a complete record with an unchanged abstract", () => {
    const report = evaluateKnowledgeSurface({
      after: COMPLETE,
      sourceAbstract: "Source abstract.",
    });
    expect(report.status).toBe("passed");
    expect(report.hardFailures).toEqual([]);
    expect(report.coreSections.missing).toEqual([]);
  });

  it("fails missing or placeholder core sections", () => {
    const report = evaluateKnowledgeSurface({
      after: COMPLETE.replace(
        "Specific method.",
        "_Not yet distilled._",
      ).replace("## Insight\nGrounded insight.\n\n", ""),
      sourceAbstract: "Source abstract.",
    });
    expect(report.status).toBe("failed");
    expect(report.coreSections.missing).toEqual(["Insight"]);
    expect(report.coreSections.placeholder).toEqual(["Method"]);
  });

  it("requires review when the abstract is materially rewritten", () => {
    const report = evaluateKnowledgeSurface({
      after: COMPLETE.replace("Source abstract.", "A generated short summary."),
      sourceAbstract: "Source abstract.",
    });
    expect(report.status).toBe("needs-review");
    expect(report.abstract.status).toBe("changed");
  });

  it("fails malformed semantic relationship candidates", () => {
    const report = evaluateKnowledgeSurface({
      after: COMPLETE.replace(
        "### Semantic Relationships\n",
        "### Semantic Relationships\n- [extends] malformed target\n",
      ),
      sourceAbstract: "Source abstract.",
      itemKey: "AAAA1111",
    });
    expect(report.status).toBe("failed");
    expect(report.relationships).toEqual({ candidates: 1, parsed: 0 });
  });

  it("ignores bracketed bullets outside Semantic Relationships", () => {
    const report = evaluateKnowledgeSurface({
      after: COMPLETE.replace(
        "Specific method.",
        "Specific method.\n- [stage] internal pipeline label",
      ),
      sourceAbstract: "Source abstract.",
    });
    expect(report.relationships).toEqual({ candidates: 0, parsed: 0 });
    expect(report.status).toBe("passed");
  });

  it("ignores a Semantic Relationships heading outside Library Connections", () => {
    const report = evaluateKnowledgeSurface({
      after: COMPLETE.replace(
        "## Method\nSpecific method.",
        "## Method\nSpecific method.\n\n### Semantic Relationships\n- [extends] malformed",
      ).replace(
        "### Semantic Relationships\n\n## Evidence",
        "### Other\n\n## Evidence",
      ),
      sourceAbstract: "Source abstract.",
    });
    expect(report.relationships).toEqual({ candidates: 0, parsed: 0 });
  });

  it("flags append growth above 25 percent for an established record", () => {
    const report = evaluateKnowledgeSurface({
      before: COMPLETE,
      after: `${COMPLETE}\n${"Additional repeated material. ".repeat(20)}`,
      sourceAbstract: "Source abstract.",
    });
    expect(report.status).toBe("needs-review");
    expect(report.growth.reviewRequired).toBe(true);
  });

  it("uses tier-aware required sections for an L1 record", () => {
    const report = evaluateKnowledgeSurface({
      after: `---
tier: L1
---

# Paper

<!-- zotero-agent:paper:start -->
## Abstract
Source abstract.
<!-- zotero-agent:paper:end -->

## TL;DR
Short finding.

## Contribution
Contribution.

## Method
Method skeleton.

## Takeaways
Takeaway.

## Library Connections

### Semantic Relationships
`,
      sourceAbstract: "Source abstract.",
    });

    expect(report.status).toBe("passed");
    expect(report.tier).toBe("L1");
    expect(report.coreSections.missing).toEqual([]);
  });

  it("fails when a v2 record loses the plugin-owned block", () => {
    const report = evaluateKnowledgeSurface({
      after: `---
tier: L1
---

## TL;DR
Finding.

## Contribution
Contribution.

## Method
Method.

## Takeaways
Takeaway.

## Library Connections
`,
    });

    expect(report.status).toBe("failed");
    expect(report.hardFailures).toContain(
      "Plugin-owned bibliography/abstract block is missing or malformed.",
    );
  });

  it("fails when Codex changes the plugin-owned block during a turn", () => {
    const before = `---
tier: L1
---

<!-- zotero-agent:paper:start -->
## Abstract
Original abstract.
<!-- zotero-agent:paper:end -->

## TL;DR
Finding.

## Contribution
Contribution.

## Method
Method.

## Takeaways
Takeaway.

## Library Connections
`;
    const report = evaluateKnowledgeSurface({
      before,
      after: before.replace("Original abstract.", "Changed abstract."),
      sourceAbstract: "Original abstract.",
    });

    expect(report.status).toBe("failed");
    expect(report.hardFailures).toContain(
      "Plugin-owned bibliography/abstract block changed during the turn.",
    );
  });

  it("requires the close-reading sections for an L2 record", () => {
    const report = evaluateKnowledgeSurface({
      after: `---
tier: L2
---

# Paper

## Abstract
Source abstract.

## Contribution
Contribution.

## Method
Method.

## Takeaways
Takeaway.
`,
      sourceAbstract: "Source abstract.",
    });

    expect(report.status).toBe("failed");
    expect(report.coreSections.missing).toEqual([
      "Problem",
      "Insight",
      "Results",
      "Library Connections",
    ]);
  });
});

describe("isUnbuiltSkeleton", () => {
  it("is true for a fresh, never-touched L1 skeleton", () => {
    const report = evaluateKnowledgeSurface({ after: L1_SKELETON });
    expect(isUnbuiltSkeleton(report)).toBe(true);
  });

  it("is false once the record has real content", () => {
    const report = evaluateKnowledgeSurface({
      after: COMPLETE,
      sourceAbstract: "Source abstract.",
    });
    expect(isUnbuiltSkeleton(report)).toBe(false);
  });
});
