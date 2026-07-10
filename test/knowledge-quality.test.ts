import { describe, expect, it } from "vitest";
import { evaluateKnowledgeSurface } from "../src/services/knowledge-quality";

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
      after: COMPLETE.replace("Specific method.", "_Not yet distilled._").replace(
        "## Insight\nGrounded insight.\n\n",
        "",
      ),
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

  it("flags append growth above 25 percent for an established record", () => {
    const report = evaluateKnowledgeSurface({
      before: COMPLETE,
      after: `${COMPLETE}\n${"Additional repeated material. ".repeat(20)}`,
      sourceAbstract: "Source abstract.",
    });
    expect(report.status).toBe("needs-review");
    expect(report.growth.reviewRequired).toBe(true);
  });
});
