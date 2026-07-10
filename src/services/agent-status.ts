export type AgentStatusKind = "progress" | "notice";

export type AgentStatusPresentation = {
  className: string;
  animated: boolean;
};

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
