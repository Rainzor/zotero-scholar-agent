import { describe, expect, it } from "vitest";
import { getAgentStatusPresentation } from "../src/services/agent-status";

describe("getAgentStatusPresentation", () => {
  it("keeps in-progress activity animated", () => {
    expect(getAgentStatusPresentation("progress")).toEqual({
      className: "zoteroagent-agent-status",
      animated: true,
    });
  });

  it("renders completed-action notices without an infinite animation", () => {
    expect(getAgentStatusPresentation("notice")).toEqual({
      className: "zoteroagent-agent-status is-notice",
      animated: false,
    });
  });
});
