import { describe, expect, it } from "vitest";
import {
  AGENT_STATUS_NOTICE_AUTO_DISMISS_MS,
  getAgentStatusPresentation,
} from "../src/services/agent-status";

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

describe("AGENT_STATUS_NOTICE_AUTO_DISMISS_MS", () => {
  it("matches the undo-toast auto-dismiss duration", () => {
    expect(AGENT_STATUS_NOTICE_AUTO_DISMISS_MS).toBe(6000);
  });
});
