import { describe, expect, it } from "vitest";
import {
  applyRelationshipProposal,
  extractRelationshipProposals,
} from "../src/services/relationship-proposals";

describe("relationship proposals", () => {
  it("extracts valid proposals from a hidden JSON marker", () => {
    const parsed = extractRelationshipProposals(`Done.

<!-- relationship-proposals: [{"type":"extends","targetItemKey":"BBBB2222","title":"Paper B","rationale":"Adds temporal conditioning.","evidence":"[page 4]"},{"type":"unknown","targetItemKey":"CCCC3333","title":"Paper C","rationale":"Ignored."}] -->
`);

    expect(parsed.content).toBe("Done.");
    expect(parsed.proposals).toEqual([
      {
        type: "extends",
        targetItemKey: "BBBB2222",
        title: "Paper B",
        rationale: "Adds temporal conditioning.",
        evidence: "[page 4]",
      },
    ]);
  });

  it("writes an accepted proposal into Semantic Relationships once", () => {
    const memory = `## Library Connections

### Semantic Relationships
`;
    const proposal = {
      type: "supports" as const,
      targetItemKey: "BBBB2222",
      title: "Paper B",
      rationale: "Reports the same effect.",
      evidence: "[page 7]",
    };
    const first = applyRelationshipProposal(memory, proposal);
    const second = applyRelationshipProposal(first, proposal);

    expect(first).toContain(
      "- [supports] [Paper B](../BBBB2222/memory.md): Reports the same effect. Evidence: [page 7]",
    );
    expect(second).toBe(first);
  });
});
