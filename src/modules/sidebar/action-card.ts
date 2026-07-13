import type { AgentActionCard } from "../../services/chat-actions/types";

export type ActionCardCommand =
  | "confirm"
  | "dismiss"
  | "cancel"
  | "retry"
  | "view"
  | "undo";

export type ActionCardViewModel = {
  title: string;
  detail: string;
  meta: string;
  tone: "neutral" | "progress" | "success" | "error" | "muted";
  actions: Array<{ id: ActionCardCommand; label: string }>;
};

export function getActionCardViewModel(
  action: AgentActionCard,
): ActionCardViewModel {
  const title =
    action.kind === "note.organize"
      ? "Organize note"
      : action.kind === "paper.rating.set"
        ? "Set rating"
        : action.kind === "paper.depth.set"
          ? "Change depth"
          : "Research action";
  const meta = [
    action.trigger.source.replace(/-/g, " "),
    action.target?.path,
    action.capabilities.join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
  if (action.state === "proposed") {
    return {
      title,
      detail:
        action.statusText ||
        action.request.content ||
        action.target?.path ||
        "",
      meta,
      tone: "neutral",
      actions: [
        { id: "confirm", label: "Confirm" },
        { id: "dismiss", label: "Dismiss" },
      ],
    };
  }
  if (action.state === "running") {
    const committing = action.statusText?.startsWith("Committing");
    return {
      title,
      detail: action.statusText || "Working...",
      meta,
      tone: "progress",
      actions: committing ? [] : [{ id: "cancel", label: "Cancel" }],
    };
  }
  if (action.state === "completed") {
    const undoable =
      (action.kind === "note.organize" ||
        action.kind === "paper.rating.set" ||
        action.kind === "paper.depth.set") &&
      Boolean(action.result?.commitReceipt);
    return {
      title,
      detail: action.error?.message || action.result?.summary || "Completed.",
      meta,
      tone: "success",
      actions: [
        { id: "view", label: "View" },
        ...(undoable ? [{ id: "undo" as const, label: "Undo" }] : []),
      ],
    };
  }
  if (action.state === "failed" || action.state === "cancelled") {
    return {
      title,
      detail:
        action.error?.message ||
        (action.state === "cancelled" ? "Cancelled." : "Action failed."),
      meta,
      tone: "error",
      actions: action.error?.retryable ? [{ id: "retry", label: "Retry" }] : [],
    };
  }
  return {
    title,
    detail: action.state === "undone" ? "Undone." : "Dismissed.",
    meta,
    tone: "muted",
    actions: [],
  };
}

export function buildAgentActionCard(
  doc: Document,
  action: AgentActionCard,
  onCommand: (command: ActionCardCommand) => void,
): HTMLElement {
  const view = getActionCardViewModel(action);
  const card = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  card.className = `zoteroagent-action-card is-${view.tone} is-${action.state}`;
  card.dataset.actionId = action.id;

  const heading = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  heading.className = "zoteroagent-action-card-title";
  heading.textContent = view.title;
  const state = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "span",
  ) as HTMLElement;
  state.className = "zoteroagent-action-card-state";
  state.textContent = action.state;
  heading.appendChild(state);

  const detail = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  detail.className = "zoteroagent-action-card-detail";
  detail.textContent = view.detail;
  card.appendChild(heading);
  card.appendChild(detail);

  const meta = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  meta.className = "zoteroagent-action-card-meta";
  meta.textContent = view.meta;
  card.appendChild(meta);

  if (view.actions.length) {
    const actions = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    actions.className = "zoteroagent-action-card-actions";
    for (const command of view.actions) {
      const button = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "button",
      ) as HTMLButtonElement;
      button.type = "button";
      button.textContent = command.label;
      button.dataset.command = command.id;
      button.addEventListener("click", () => onCommand(command.id));
      actions.appendChild(button);
    }
    card.appendChild(actions);
  }
  return card;
}
