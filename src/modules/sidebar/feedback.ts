const XHTML_NS = "http://www.w3.org/1999/xhtml";

export function showUndoToast(
  body: HTMLElement,
  message: string,
  onUndo: () => boolean,
): HTMLButtonElement {
  const host =
    (body.querySelector("#zoteroagent-chat-panel") as HTMLElement | null) ||
    body;
  host.querySelector(".zoteroagent-undo-toast")?.remove();

  const toast = body.ownerDocument.createElementNS(XHTML_NS, "div");
  toast.className = "zoteroagent-undo-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  const text = body.ownerDocument.createElementNS(XHTML_NS, "span");
  text.className = "zoteroagent-undo-toast-text";
  text.textContent = message;

  const undo = body.ownerDocument.createElementNS(
    XHTML_NS,
    "button",
  ) as HTMLButtonElement;
  undo.type = "button";
  undo.className = "zoteroagent-undo-toast-action";
  undo.textContent = "Undo";
  undo.addEventListener("click", () => {
    if (onUndo()) {
      toast.remove();
      return;
    }
    text.textContent = "Undo is no longer available";
    undo.disabled = true;
  });

  toast.appendChild(text);
  toast.appendChild(undo);
  host.appendChild(toast);
  body.ownerDocument.defaultView?.setTimeout(() => toast.remove(), 6000);
  return undo;
}
