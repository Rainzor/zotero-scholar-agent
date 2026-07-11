const XHTML_NS = "http://www.w3.org/1999/xhtml";

const SUGGESTIONS = [
  "Summarize the core contribution",
  "How does the method differ from its baselines?",
  "What are the limitations and open questions?",
];

export function buildEmptyChatState(
  doc: Document,
  paperTitle: string,
  onSelectSuggestion: (suggestion: string) => void,
): HTMLElement {
  const state = doc.createElementNS(XHTML_NS, "section");
  state.className = "zoteroagent-empty-chat";

  const title = doc.createElementNS(XHTML_NS, "h2");
  title.className = "zoteroagent-empty-chat-title";
  title.textContent = paperTitle;
  state.appendChild(title);

  const detail = doc.createElementNS(XHTML_NS, "p");
  detail.className = "zoteroagent-empty-chat-detail";
  detail.textContent =
    "Ask Codex to examine this paper and update its Knowledge Record.";
  state.appendChild(detail);

  const suggestions = doc.createElementNS(XHTML_NS, "div");
  suggestions.className = "zoteroagent-empty-chat-suggestions";
  for (const suggestion of SUGGESTIONS) {
    const button = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
    button.type = "button";
    button.className = "zoteroagent-empty-chat-suggestion";
    button.textContent = suggestion;
    button.addEventListener("click", () => onSelectSuggestion(suggestion));
    suggestions.appendChild(button);
  }
  state.appendChild(suggestions);
  return state;
}
