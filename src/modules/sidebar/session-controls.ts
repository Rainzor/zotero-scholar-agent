import { chatStore } from "../../services/chat-store";
import { showUndoToast } from "./feedback";
import { setIconButton } from "./icons";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

export type SessionActionElements = {
  menuToggle: HTMLButtonElement;
  menu: HTMLElement;
  deleteConfirm: HTMLElement;
};

export type SessionControlOptions = {
  isGenerating: () => boolean;
  compact: (itemId: number) => void;
  refresh: (itemId: number) => void;
};

export function createSessionActionElements(
  doc: Document,
): SessionActionElements {
  const menuToggle = doc.createElementNS(
    XHTML_NS,
    "button",
  ) as HTMLButtonElement;
  menuToggle.id = "zoteroagent-session-menu-toggle";
  menuToggle.className = "zoteroagent-session-action icon-only";
  menuToggle.setAttribute("aria-haspopup", "true");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-controls", "zoteroagent-session-menu");
  setIconButton(menuToggle, "more", "Session actions");

  const menu = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  menu.id = "zoteroagent-session-menu";
  menu.className = "zoteroagent-session-menu";
  menu.style.display = "none";
  menu.appendChild(createMenuItem(doc, "zoteroagent-session-rename", "Rename"));
  menu.appendChild(
    createMenuItem(doc, "zoteroagent-session-compact", "Compact context"),
  );
  const deleteItem = createMenuItem(
    doc,
    "zoteroagent-session-delete",
    "Delete session",
  );
  deleteItem.classList.add("danger");
  menu.appendChild(deleteItem);

  const deleteConfirm = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  deleteConfirm.id = "zoteroagent-session-delete-confirm";
  deleteConfirm.className = "zoteroagent-session-confirm";
  deleteConfirm.style.display = "none";
  const text = doc.createElementNS(XHTML_NS, "span");
  text.textContent = "Delete this session?";
  const cancel = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  cancel.id = "zoteroagent-session-delete-cancel";
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const confirm = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  confirm.id = "zoteroagent-session-delete-confirm-action";
  confirm.type = "button";
  confirm.textContent = "Delete";
  deleteConfirm.appendChild(text);
  deleteConfirm.appendChild(cancel);
  deleteConfirm.appendChild(confirm);

  return { menuToggle, menu, deleteConfirm };
}

export function bindSessionControls(
  body: HTMLElement,
  options: SessionControlOptions,
): void {
  body
    .querySelector("#zoteroagent-session-menu-toggle")
    ?.addEventListener("click", () => toggleMenu(body, options));
  body
    .querySelector("#zoteroagent-session-menu")
    ?.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Escape") return;
      event.preventDefault();
      hideMenu(body);
      focusMenuToggle(body);
    });
  body
    .querySelector("#zoteroagent-session-rename")
    ?.addEventListener("click", () => {
      const itemId = Number(body.dataset.itemID);
      if (itemId <= 0) return;
      hideMenu(body);
      enterRename(body, itemId);
    });
  body
    .querySelector("#zoteroagent-session-compact")
    ?.addEventListener("click", () => {
      const itemId = Number(body.dataset.itemID);
      if (itemId <= 0) return;
      hideMenu(body);
      options.compact(itemId);
    });
  body
    .querySelector("#zoteroagent-session-delete")
    ?.addEventListener("click", () => {
      const itemId = Number(body.dataset.itemID);
      const session = itemId > 0 ? chatStore.getSession(itemId) : null;
      if (!session) return;
      hideMenu(body);
      showDeleteConfirm(body, session.sessionId);
    });
  body
    .querySelector("#zoteroagent-session-delete-cancel")
    ?.addEventListener("click", () => {
      hideDeleteConfirm(body);
      focusMenuToggle(body);
    });
  body
    .querySelector("#zoteroagent-session-delete-confirm-action")
    ?.addEventListener("click", () => {
      const itemId = Number(body.dataset.itemID);
      if (itemId <= 0) return;
      const confirm = body.querySelector(
        "#zoteroagent-session-delete-confirm",
      ) as HTMLElement | null;
      const receipt = chatStore.deleteSession(
        itemId,
        confirm?.dataset.sessionId,
      );
      hideDeleteConfirm(body);
      if (!receipt) return;
      options.refresh(itemId);
      const undo = showUndoToast(body, "Session deleted", () => {
        const result = chatStore.restoreSession(receipt);
        if (!result.restored) return false;
        options.refresh(itemId);
        return true;
      });
      undo.focus();
    });
  body
    .querySelector("#zoteroagent-session-delete-confirm")
    ?.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Escape") return;
      event.preventDefault();
      hideDeleteConfirm(body);
      focusMenuToggle(body);
    });
  body.addEventListener("pointerdown", (event) => {
    const target = event.target as Element | null;
    if (
      !target?.closest(
        "#zoteroagent-session-menu, #zoteroagent-session-menu-toggle",
      )
    ) {
      hideMenu(body);
    }
  });
  body
    .querySelector("#zoteroagent-session-menu")
    ?.addEventListener("focusout", (event) => {
      const next = (event as FocusEvent).relatedTarget as Node | null;
      const menu = event.currentTarget as HTMLElement;
      const toggle = body.querySelector("#zoteroagent-session-menu-toggle");
      if (!next || (!menu.contains(next) && !toggle?.contains(next))) {
        hideMenu(body);
      }
    });
}

export function syncSessionTitle(body: HTMLElement, itemId: number): void {
  const title = body.querySelector(
    "#zoteroagent-session-title",
  ) as HTMLElement | null;
  if (!title || title.classList.contains("is-editing")) return;
  title.textContent = chatStore.getSession(itemId)?.title || "New chat";
}

function createMenuItem(
  doc: Document,
  id: string,
  label: string,
): HTMLButtonElement {
  const item = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  item.id = id;
  item.type = "button";
  item.className = "zoteroagent-session-menu-item";
  item.textContent = label;
  return item;
}

function toggleMenu(body: HTMLElement, options: SessionControlOptions): void {
  const menu = body.querySelector(
    "#zoteroagent-session-menu",
  ) as HTMLElement | null;
  const toggle = body.querySelector(
    "#zoteroagent-session-menu-toggle",
  ) as HTMLButtonElement | null;
  if (!menu || !toggle) return;
  const open = menu.style.display === "none";
  menu.style.display = open ? "flex" : "none";
  toggle.setAttribute("aria-expanded", String(open));
  if (!open) return;

  const itemId = Number(body.dataset.itemID);
  const session = itemId > 0 ? chatStore.getSession(itemId) : null;
  const compact = menu.querySelector(
    "#zoteroagent-session-compact",
  ) as HTMLButtonElement | null;
  if (compact) {
    compact.disabled =
      options.isGenerating() ||
      !session ||
      session.messages.length < 2 ||
      body.dataset.contextDigestBusy === "true";
  }
  (
    menu.querySelector(
      ".zoteroagent-session-menu-item:not(:disabled)",
    ) as HTMLButtonElement | null
  )?.focus();
}

function hideMenu(body: HTMLElement): void {
  const menu = body.querySelector(
    "#zoteroagent-session-menu",
  ) as HTMLElement | null;
  const toggle = body.querySelector(
    "#zoteroagent-session-menu-toggle",
  ) as HTMLButtonElement | null;
  if (menu) menu.style.display = "none";
  toggle?.setAttribute("aria-expanded", "false");
}

function showDeleteConfirm(body: HTMLElement, sessionId: string): void {
  const confirm = body.querySelector(
    "#zoteroagent-session-delete-confirm",
  ) as HTMLElement | null;
  if (!confirm) return;
  confirm.dataset.sessionId = sessionId;
  confirm.style.display = "flex";
  (
    confirm.querySelector(
      "#zoteroagent-session-delete-cancel",
    ) as HTMLButtonElement | null
  )?.focus();
}

function hideDeleteConfirm(body: HTMLElement): void {
  const confirm = body.querySelector(
    "#zoteroagent-session-delete-confirm",
  ) as HTMLElement | null;
  if (!confirm) return;
  confirm.style.display = "none";
  delete confirm.dataset.sessionId;
}

function focusMenuToggle(body: HTMLElement): void {
  (
    body.querySelector(
      "#zoteroagent-session-menu-toggle",
    ) as HTMLButtonElement | null
  )?.focus();
}

function enterRename(body: HTMLElement, itemId: number): void {
  const session = chatStore.getSession(itemId);
  const title = body.querySelector(
    "#zoteroagent-session-title",
  ) as HTMLElement | null;
  if (!session || !title || title.classList.contains("is-editing")) return;
  title.classList.add("is-editing");
  title.textContent = "";
  const input = title.ownerDocument.createElementNS(
    XHTML_NS,
    "input",
  ) as HTMLInputElement;
  input.type = "text";
  input.className = "zoteroagent-session-title-input";
  input.value = session.title;
  input.setAttribute("aria-label", "Session title");
  title.appendChild(input);

  let finished = false;
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    if (commit && input.value.trim()) {
      chatStore.renameSession(itemId, input.value.trim(), session.sessionId);
    }
    title.classList.remove("is-editing");
    syncSessionTitle(body, itemId);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    }
  });
  input.addEventListener("blur", () => finish(true));
  input.focus();
  input.select();
}
