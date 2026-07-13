export type AgentStatusKind = "progress" | "notice";

export type AgentStatusPresentation = {
  className: string;
  animated: boolean;
};

// How long a one-off "notice" (as opposed to an in-progress "busy" status)
// stays visible before it self-dismisses, matching the undo-toast duration.
export const AGENT_STATUS_NOTICE_AUTO_DISMISS_MS = 6000;

// Keep indefinite animation reserved for in-progress work. Completed-action
// notices remain visible for review but must be visually stable.
export function getAgentStatusPresentation(
  kind: AgentStatusKind,
): AgentStatusPresentation {
  if (kind === "notice") {
    return {
      className: "zoteroagent-agent-status is-notice",
      animated: false,
    };
  }
  return {
    className: "zoteroagent-agent-status",
    animated: true,
  };
}
