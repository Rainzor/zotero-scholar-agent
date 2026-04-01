import { config } from "../../package.json";
import { getLocaleID } from "../utils/locale";
import { renderMarkdown } from "../utils/markdown";
import { AIService } from "../services/ai-service";
import { askPrompt, summarizePrompt } from "../services/prompts";
import { getContextByMode, getFullText } from "./pdf-context";
import type { ContextInfo } from "../services/prompts";
import { loadServices, getActiveServiceId, setActiveServiceId, getActiveService } from "../utils/services";
import type { ChatMessage, ContextMode } from "../addon";
import { chatStore } from "../services/chat-store";

let agentPanel: Element | null = null;
let agentRoot: HTMLElement | null = null;
let injectedButtons: Element[] = [];
let notifierID: string | null = null;
let activeXHR: XMLHttpRequest | null = null;
let isGenerating = false;

export function injectAgentPanel(win: Window) {
  try {
    const doc = win.document;

    injectDeckPanel(doc);
    injectAllSidenavButtons(doc);

    notifierID = Zotero.Notifier.registerObserver(
      {
        notify: (action: string, type: string, _ids: string[] | number[]) => {
          try {
            if (type === "tab" && ["select", "load"].includes(action)) {
              const deckEl = resolveContextDeck(
                win.document,
                win.document.querySelector("item-pane-sidenav"),
              );
              ensureDeckPanel(win.document, deckEl);
              injectAllSidenavButtons(win.document);
              updateAgentEntryVisibility();
              onTabSelect();
            }
          } catch (_e) {
            // ignore
          }
        },
      },
      ["tab"],
      "agentPanel",
    );
  } catch (e) {
    ztoolkit.log("[Agent] injectAgentPanel error:", e);
  }
}

export function removeAgentPanel(_win: Window) {
  try {
    if (notifierID) {
      Zotero.Notifier.unregisterObserver(notifierID);
      notifierID = null;
    }
    agentPanel?.remove();
    agentPanel = null;
    agentRoot = null;
    for (const el of injectedButtons) {
      el.remove();
    }
    injectedButtons = [];
  } catch (_e) {
    // ignore
  }
}

function resolveContextDeck(doc: Document, contextEl?: Element | null): Element | null {
  const paneContainer = contextEl?.closest("[class*='context-pane']") as Element | null;
  const scopedDeck = paneContainer?.querySelector("#zotero-context-pane-deck");
  if (scopedDeck) return scopedDeck as Element;
  return doc.getElementById("zotero-context-pane-deck");
}

function injectDeckPanel(doc: Document, targetDeck?: Element | null) {
  const deck = targetDeck || resolveContextDeck(doc);
  if (!deck) return;
  if (agentPanel && agentPanel.isConnected && agentPanel.parentElement === deck) return;
  if (agentPanel && agentPanel.parentElement && agentPanel.parentElement !== deck) {
    agentPanel.remove();
  }
  agentPanel = null;
  agentRoot = null;

  agentPanel = doc.createXULElement("vbox");
  agentPanel.id = "zoteroagent-context-panel";
  agentPanel.setAttribute("flex", "1");
  (agentPanel as any).style.cssText = "position:relative;";
  deck.appendChild(agentPanel);

  agentRoot = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  agentRoot.id = "zoteroagent-context-root";
  agentRoot.style.cssText = "position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;";
  agentPanel.appendChild(agentRoot);

  ensureChatUI(agentRoot);
}

function ensureDeckPanel(doc: Document, targetDeck?: Element | null) {
  const deck = targetDeck || resolveContextDeck(doc);
  if (!deck) return;
  if (!agentPanel || !agentPanel.isConnected || agentPanel.parentElement !== deck) {
    injectDeckPanel(doc, deck);
  }
}

function injectAllSidenavButtons(doc: Document) {
  const allSidenavs = doc.querySelectorAll("item-pane-sidenav");
  for (let i = 0; i < allSidenavs.length; i++) {
    const sn = allSidenavs[i] as Element;
    if (sn.querySelector("#zoteroagent-sidenav-btn")) continue;
    const container = sn.closest("[class*='context-pane']") || sn.parentElement;
    if (container && container.id === "zotero-item-pane-sidenav-container") continue;
    injectSidenavButton(doc, sn);
    interceptSidenavClicks(sn);
  }
  updateAgentEntryVisibility();
}

export function updateSidebarPanels() {
  try {
    updateAgentEntryVisibility();
    if (agentRoot && isAgentPanelVisible()) {
      refreshAgentContent();
      syncPrefill(agentRoot);
    }
  } catch (_e) {
    // ignore
  }
}

export function showAgentPanel(contextEl?: Element | null) {
  try {
    updateAgentEntryVisibility();
    const win = Zotero.getMainWindow();
    const deckEl = win
      ? resolveContextDeck(win.document, contextEl || win.document.querySelector("item-pane-sidenav"))
      : null;
    if (win) ensureDeckPanel(win.document, deckEl);
    if (!agentPanel || !agentRoot) return;
    const deck = (deckEl || agentPanel.parentElement) as any;
    if (!deck) return;
    deck.selectedPanel = agentPanel;
    updateSidenavHighlight(true);
    refreshAgentContent();
    syncPrefill(agentRoot);
  } catch (_e) {
    // ignore
  }
}

function injectSidenavButton(doc: Document, sidenav: Element) {
  const iconUrl = `chrome://${config.addonRef}/content/icons/section-20.svg`;

  const wrapper = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  wrapper.id = "zoteroagent-sidenav-wrapper";
  wrapper.style.cssText =
    "display:flex;align-items:center;justify-content:center;padding:4px 0;pointer-events:all;";

  const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  btn.id = "zoteroagent-sidenav-btn";
  btn.title = "Agent Chat";
  btn.setAttribute("role", "button");
  btn.setAttribute("tabindex", "0");
  btn.style.cssText = `
    width:28px; height:28px;
    background-image: url('${iconUrl}');
    background-size: 20px 20px;
    background-repeat: no-repeat;
    background-position: center;
    cursor: pointer;
    border-radius: 4px;
    box-sizing: border-box;
    pointer-events: all;
    opacity: 0.75;
    transition: opacity 120ms, background-color 120ms;
  `;

  wrapper.appendChild(btn);

  const divider = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  divider.id = "zoteroagent-sidenav-divider";
  divider.style.cssText =
    "height:1px;margin:4px 6px;background:var(--fill-quinary, rgba(0,0,0,0.08));";

  injectedButtons.push(wrapper, divider);

  const togglePaneBtn = sidenav.querySelector('[data-action="toggle-pane"]');
  if (togglePaneBtn?.parentElement) {
    togglePaneBtn.parentElement.before(divider, wrapper);
  } else {
    sidenav.appendChild(divider);
    sidenav.appendChild(wrapper);
  }

  const handleToggle = (e: Event) => {
    try {
      e.stopPropagation();
      e.preventDefault();

      const win = Zotero.getMainWindow();
      if (!win) return;
      const deckEl = resolveContextDeck(win.document, sidenav);
      ensureDeckPanel(win.document, deckEl);

      const deck = (deckEl || agentPanel?.parentElement) as any;
      if (!deck || !agentPanel) return;

      if (deck.selectedPanel === agentPanel) {
        switchBackToItemDetails(deck);
        updateSidenavHighlight(false);
      } else {
        showAgentPanel();
      }
    } catch (_e) {
      ztoolkit.log("[Agent] sidenav btn toggle error:", _e);
    }
  };

  btn.addEventListener("click", handleToggle);
  wrapper.addEventListener("click", handleToggle);

  btn.addEventListener("mouseenter", () => {
    btn.style.opacity = "1";
    btn.style.backgroundColor = "var(--fill-quinary, rgba(0,0,0,0.06))";
  });
  btn.addEventListener("mouseleave", () => {
    const isActive = agentPanel?.parentElement &&
      (agentPanel.parentElement as any).selectedPanel === agentPanel;
    btn.style.opacity = isActive ? "1" : "0.75";
    btn.style.backgroundColor = isActive
      ? "var(--fill-quinary, rgba(0,0,0,0.06))" : "transparent";
  });
}

function interceptSidenavClicks(sidenav: Element) {
  sidenav.addEventListener(
    "mousedown",
    (e: Event) => {
      try {
        const target = e.target as HTMLElement;
        if (!target) return;
        if (target.id === "zoteroagent-sidenav-btn" ||
            target.id === "zoteroagent-sidenav-wrapper") return;
        const doc = sidenav.ownerDocument;
        const deck = resolveContextDeck(doc, sidenav) as any;
        if (deck?.selectedPanel === agentPanel) {
          switchBackToItemDetails(deck);
        }
        updateSidenavHighlight(false);
      } catch (_e) {
        // ignore
      }
    },
    true,
  );
}

function switchBackToItemDetails(deck: any) {
  const itemDeck = deck.querySelector("#zotero-context-pane-item-deck");
  if (!itemDeck) return;
  const parent = Array.from(deck.children as HTMLCollection).find(
    (child: Element) => child.contains(itemDeck),
  );
  if (parent) {
    (deck as any).selectedPanel = parent;
  }
}

function updateSidenavHighlight(active: boolean) {
  const allBtns = Zotero.getMainWindow()?.document.querySelectorAll("#zoteroagent-sidenav-btn");
  if (!allBtns) return;
  for (const btn of Array.from(allBtns)) {
    const el = btn as HTMLElement;
    el.style.opacity = active ? "1" : "0.75";
    el.style.backgroundColor = active
      ? "var(--fill-quinary, rgba(0,0,0,0.06))" : "transparent";
  }
}

function shouldShowAgentEntry(): boolean {
  try {
    const tabId =
      (typeof Zotero_Tabs !== "undefined"
        ? (Zotero_Tabs as any).selectedID
        : "") ||
      (Zotero as any).getActiveZoteroPane?.()?.getSelectedTabID?.() ||
      "";
    if (!tabId) return false;
    const reader = Zotero.Reader?.getByTabID?.(tabId);
    return Boolean(reader?._item?.id);
  } catch (_e) {
    // ignore
  }
  return false;
}

function updateAgentEntryVisibility() {
  const doc = Zotero.getMainWindow()?.document;
  if (!doc) return;
  const show = shouldShowAgentEntry();
  const els = doc.querySelectorAll("#zoteroagent-sidenav-wrapper, #zoteroagent-sidenav-divider");
  for (const el of Array.from(els)) {
    (el as HTMLElement).style.display = show ? "" : "none";
  }
  if (!show) {
    const deck = agentPanel?.parentElement as any;
    if (deck?.selectedPanel === agentPanel) {
      switchBackToItemDetails(deck);
      updateSidenavHighlight(false);
    }
  }
}

function isAgentPanelVisible(): boolean {
  if (!agentPanel) return false;
  const deck = agentPanel.parentElement as any;
  return deck?.selectedPanel === agentPanel;
}

function onTabSelect() {
  if (!agentRoot || !isAgentPanelVisible()) return;
  refreshAgentContent();
}

function getActiveReader(): _ZoteroTypes.ReaderInstance | null {
  const tabId =
    (typeof Zotero_Tabs !== "undefined"
      ? (Zotero_Tabs as any).selectedID
      : "") ||
    (Zotero as any).getActiveZoteroPane?.()?.getSelectedTabID?.() ||
    "";
  if (tabId) {
    const r = Zotero.Reader?.getByTabID?.(tabId);
    if (r) return r;
  }
  if (addon.data.popup.currentReader) {
    return addon.data.popup.currentReader;
  }
  const readers = (Zotero.Reader as any)?._readers;
  if (Array.isArray(readers) && readers.length > 0) {
    return readers[readers.length - 1];
  }
  return null;
}

function refreshAgentContent() {
  if (!agentRoot) return;
  const reader = getActiveReader();
  const itemId = reader?._item?.id || 0;

  if (itemId > 0) {
    agentRoot.dataset.itemID = String(itemId);
    addon.data.popup.currentReader = reader;
    const session = chatStore.getSession(itemId);
    if (session) {
      addon.data.chat.contextMode = session.contextMode;
    }
    syncSessionSelector(agentRoot, itemId);
    renderMessages(agentRoot, itemId);
    syncContextSelector(agentRoot, itemId);
    syncLayoutState(agentRoot, itemId);
  }
}

// ===================== Chat UI =====================

function ensureChatUI(body: HTMLElement) {
  if (body.querySelector("#zoteroagent-chat-panel")) return;

  const doc = body.ownerDocument;
  const container = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  container.id = "zoteroagent-chat-panel";
  container.className = "zoteroagent-chat-panel";
  body.dataset.chatMode = "welcome";

  const welcome = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  welcome.id = "zoteroagent-chat-welcome";
  welcome.className = "zoteroagent-chat-welcome";

  const welcomeTitle = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  welcomeTitle.className = "zoteroagent-welcome-title";
  welcomeTitle.textContent = "Agent Chat";

  const welcomeDesc = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  welcomeDesc.className = "zoteroagent-welcome-desc";
  welcomeDesc.textContent = "Choose a mode to start";

  const modeButtons = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  modeButtons.className = "zoteroagent-mode-buttons";

  const analyzeBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  analyzeBtn.id = "zoteroagent-mode-analyze";
  analyzeBtn.className = "zoteroagent-mode-button";
  analyzeBtn.textContent = "分析文献";

  const chatModeBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  chatModeBtn.id = "zoteroagent-mode-chat";
  chatModeBtn.className = "zoteroagent-mode-button";
  chatModeBtn.textContent = "对话提问";

  modeButtons.appendChild(analyzeBtn);
  modeButtons.appendChild(chatModeBtn);
  welcome.appendChild(welcomeTitle);
  welcome.appendChild(welcomeDesc);
  welcome.appendChild(modeButtons);

  const messagesDiv = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  messagesDiv.id = "zoteroagent-chat-messages";
  messagesDiv.className = "zoteroagent-chat-messages";

  const sessionRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  sessionRow.id = "zoteroagent-session-row";
  sessionRow.className = "zoteroagent-session-row";

  const sessionSelect = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  sessionSelect.id = "zoteroagent-session-select";
  sessionSelect.className = "zoteroagent-session-select";

  const renameSessionBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  renameSessionBtn.id = "zoteroagent-session-rename";
  renameSessionBtn.className = "zoteroagent-session-action";
  renameSessionBtn.textContent = "Rename";

  const newSessionBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  newSessionBtn.id = "zoteroagent-session-new";
  newSessionBtn.className = "zoteroagent-session-action";
  newSessionBtn.textContent = "New";

  const deleteSessionBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  deleteSessionBtn.id = "zoteroagent-session-delete";
  deleteSessionBtn.className = "zoteroagent-session-action danger";
  deleteSessionBtn.textContent = "Delete";

  sessionRow.appendChild(sessionSelect);
  sessionRow.appendChild(newSessionBtn);
  sessionRow.appendChild(renameSessionBtn);
  sessionRow.appendChild(deleteSessionBtn);

  const inputArea = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  inputArea.id = "zoteroagent-input-area";
  inputArea.className = "zoteroagent-input-area";

  const refCard = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  refCard.id = "zoteroagent-reference-card";
  refCard.className = "zoteroagent-reference-card";
  refCard.style.display = "none";

  const refHeader = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  refHeader.className = "zoteroagent-reference-header";
  const refLabel = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  refLabel.className = "zoteroagent-reference-label";
  refLabel.textContent = "引用文本";
  const refDismiss = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  refDismiss.className = "zoteroagent-reference-dismiss";
  refDismiss.innerHTML = "&#x2715;";
  refDismiss.title = "移除引用";
  refHeader.appendChild(refLabel);
  refHeader.appendChild(refDismiss);

  const refBody = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  refBody.className = "zoteroagent-reference-body";
  const refContent = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  refContent.className = "zoteroagent-reference-content";
  const refFade = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  refFade.className = "zoteroagent-reference-fade";
  refBody.appendChild(refContent);
  refBody.appendChild(refFade);

  refCard.appendChild(refHeader);
  refCard.appendChild(refBody);

  const inputRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  inputRow.id = "zoteroagent-chat-input-row";
  inputRow.className = "zoteroagent-chat-input-row";

  const textarea = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "textarea",
  ) as HTMLTextAreaElement;
  textarea.id = "zoteroagent-chat-input";
  textarea.rows = 2;
  textarea.placeholder = "提出问题，AI 将基于正在阅读页的文本回答";

  const sendBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  sendBtn.id = "zoteroagent-chat-send";
  sendBtn.className = "zoteroagent-send-button";
  sendBtn.innerHTML = "&#x27A4;";

  inputRow.appendChild(textarea);
  inputRow.appendChild(sendBtn);

  const controlsRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  controlsRow.id = "zoteroagent-controls-row";
  controlsRow.className = "zoteroagent-controls-row";

  const contextSelect = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  contextSelect.id = "zoteroagent-context-mode";
  contextSelect.className = "zoteroagent-context-select";
  for (const [val, text] of [
    ["none", "对话"],
    ["currentPage", "所在页文本"],
    ["fullPdf", "整篇PDF"],
  ]) {
    const opt = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    opt.value = val;
    opt.textContent = text;
    contextSelect.appendChild(opt);
  }

  const clearBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  clearBtn.id = "zoteroagent-chat-clear";
  clearBtn.className = "zoteroagent-clear-button";
  clearBtn.textContent = "Clear";

  const serviceSelect = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  serviceSelect.id = "zoteroagent-service-select";
  serviceSelect.className = "zoteroagent-service-select";
  populateServiceOptions(serviceSelect);

  controlsRow.appendChild(contextSelect);
  controlsRow.appendChild(clearBtn);
  controlsRow.appendChild(serviceSelect);
  inputArea.appendChild(refCard);
  inputArea.appendChild(inputRow);
  inputArea.appendChild(controlsRow);

  container.appendChild(welcome);
  container.appendChild(sessionRow);
  container.appendChild(messagesDiv);
  container.appendChild(inputArea);
  body.appendChild(container);

  bindChatEvents(body);
}

function bindChatEvents(body: HTMLElement) {
  body.querySelector("#zoteroagent-mode-analyze")?.addEventListener("click", () => {
    refreshAgentContent();
    body.dataset.chatMode = "chat";
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0) {
      syncLayoutState(body, itemId);
      void analyzePaper(body, itemId);
    }
  });
  body.querySelector("#zoteroagent-mode-chat")?.addEventListener("click", () => {
    refreshAgentContent();
    body.dataset.chatMode = "chat";
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0) {
      syncLayoutState(body, itemId);
    }
    (
      body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null
    )?.focus();
  });
  body.querySelector("#zoteroagent-chat-send")?.addEventListener("click", () => {
    void submitQuestion(body);
  });
  body.querySelector("#zoteroagent-chat-input")?.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter" && !(event as KeyboardEvent).shiftKey) {
      event.preventDefault();
      void submitQuestion(body);
    }
  });
  body.querySelector("#zoteroagent-chat-clear")?.addEventListener("click", () => {
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0) {
      chatStore.clearSession(itemId);
      renderMessages(body, itemId);
      syncLayoutState(body, itemId);
    }
  });
  body.querySelector("#zoteroagent-session-select")?.addEventListener("change", (event) => {
    const sessionId = (event.target as HTMLSelectElement).value;
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0 && sessionId) {
      chatStore.setActiveSession(itemId, sessionId);
      renderMessages(body, itemId);
      syncContextSelector(body, itemId);
      syncLayoutState(body, itemId);
    }
  });
  body.querySelector("#zoteroagent-session-new")?.addEventListener("click", () => {
    const itemId = Number(body.dataset.itemID);
    if (itemId <= 0) return;
    const session = chatStore.createSession(itemId, undefined, addon.data.chat.contextMode);
    if (!session) return;
    addon.data.chat.contextMode = session.contextMode;
    body.dataset.chatMode = "chat";
    syncSessionSelector(body, itemId);
    renderMessages(body, itemId);
    syncContextSelector(body, itemId);
    syncLayoutState(body, itemId);
    (body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null)?.focus();
  });
  body.querySelector("#zoteroagent-session-rename")?.addEventListener("click", () => {
    const itemId = Number(body.dataset.itemID);
    if (itemId <= 0) return;
    const session = chatStore.getSession(itemId);
    if (!session) return;
    const currentTitle = session.title;
    const next = body.ownerDocument.defaultView?.prompt("Session title", currentTitle);
    if (!next || !next.trim()) return;
    chatStore.renameSession(itemId, next, session.sessionId);
    syncSessionSelector(body, itemId);
  });
  body.querySelector("#zoteroagent-session-delete")?.addEventListener("click", () => {
    const itemId = Number(body.dataset.itemID);
    if (itemId <= 0) return;
    const ok = body.ownerDocument.defaultView?.confirm("Delete this session history?");
    if (!ok) return;
    const active = chatStore.getSession(itemId);
    if (!active) return;
    void chatStore.deleteSession(itemId, active.sessionId).then(() => {
      renderMessages(body, itemId);
      syncSessionSelector(body, itemId);
      syncContextSelector(body, itemId);
      syncLayoutState(body, itemId);
    });
  });
  body.querySelector(".zoteroagent-reference-dismiss")?.addEventListener("click", () => {
    addon.data.chat.referenceText = "";
    syncReferenceCard(body);
  });
  body.querySelector(".zoteroagent-reference-body")?.addEventListener("click", () => {
    const card = body.querySelector("#zoteroagent-reference-card");
    card?.classList.toggle("is-expanded");
  });
  body.querySelector("#zoteroagent-context-mode")?.addEventListener("change", (event) => {
    const mode = (event.target as HTMLSelectElement).value as ContextMode;
    addon.data.chat.contextMode = mode;
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0) {
      chatStore.updateContextMode(itemId, mode);
    }
  });
  body.querySelector("#zoteroagent-service-select")?.addEventListener("change", (event) => {
    const id = (event.target as HTMLSelectElement).value;
    if (id) setActiveServiceId(id);
  });
}

// ===================== Generation State =====================

function setGenerating(body: HTMLElement, generating: boolean) {
  isGenerating = generating;
  const sendBtn = body.querySelector("#zoteroagent-chat-send") as HTMLElement | null;
  if (!sendBtn) return;
  if (generating) {
    sendBtn.classList.add("is-stop");
    sendBtn.innerHTML = "&#x25A0;";
    sendBtn.title = "停止生成";
  } else {
    sendBtn.classList.remove("is-stop");
    sendBtn.innerHTML = "&#x27A4;";
    sendBtn.title = "发送";
    activeXHR = null;
  }
}

function abortGeneration(body: HTMLElement) {
  if (activeXHR) {
    try { activeXHR.abort(); } catch (_e) { /* ignore */ }
    activeXHR = null;
  }
  setGenerating(body, false);
  const itemId = Number(body.dataset.itemID);
  if (itemId > 0) renderMessages(body, itemId);
}

// ===================== AI Logic =====================

async function analyzePaper(body: HTMLElement, itemId: number) {
  if (isGenerating) return;
  const mode = addon.data.chat.contextMode;
  chatStore.addMessage(itemId, { role: "user", content: "分析这篇论文的核心内容、方法和局限性。" }, mode);
  const assistant: ChatMessage = { role: "assistant", content: "", reasoning: "" };
  chatStore.addMessage(itemId, assistant, mode);
  renderMessages(body, itemId);
  syncLayoutState(body, itemId);
  setGenerating(body, true);
  try {
    const fullText = await getFullText(itemId);
    if (!fullText) {
      assistant.content = "未读取到全文内容，请确认当前附件是可读的 PDF。";
      renderMessages(body, itemId);
      setGenerating(body, false);
      return;
    }
    let lastRefresh = 0;
    await AIService.chat(summarizePrompt(fullText) as any, {
      stream: true,
      onRequest: (xhr) => { activeXHR = xhr; },
      onChunk: (state) => {
        assistant.content = state.content;
        assistant.reasoning = state.reasoning;
        const now = Date.now();
        if (now - lastRefresh > 150) {
          lastRefresh = now;
          updateStreamingMessage(body, state);
        }
      },
    });
  } catch (e: any) {
    if (!assistant.content && !assistant.reasoning) {
      assistant.content = `[Error] ${e?.message || String(e)}`;
    }
  }
  chatStore.touchSession(itemId, mode);
  setGenerating(body, false);
  renderMessages(body, itemId);
}

async function submitQuestion(body: HTMLElement) {
  if (isGenerating) {
    abortGeneration(body);
    return;
  }

  const input = body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null;
  if (!input) return;
  const question = input.value.trim();
  if (!question) return;

  const itemId = Number(body.dataset.itemID);
  if (!itemId || itemId < 0) return;

  const refText = addon.data.chat.referenceText;
  const displayContent = refText
    ? `Selected Text: ${refText}\n\n${question}`
    : question;

  chatStore.addMessage(itemId, { role: "user", content: displayContent }, addon.data.chat.contextMode);
  input.value = "";
  addon.data.chat.referenceText = "";
  syncReferenceCard(body);
  body.dataset.chatMode = "chat";
  syncLayoutState(body, itemId);

  const assistant: ChatMessage = { role: "assistant", content: "", reasoning: "" };
  chatStore.addMessage(itemId, assistant, addon.data.chat.contextMode);
  const sessions = chatStore.getMessages(itemId);
  renderMessages(body, itemId);
  setGenerating(body, true);

  const reader = addon.data.popup.currentReader;
  const mode = addon.data.chat.contextMode;
  ztoolkit.log(`[Agent] submitQuestion: mode=${mode}`);
  const ctxResult = await getContextByMode({ mode, reader, itemId });
  ztoolkit.log(`[Agent] ctxResult: source=${ctxResult.source}, text.len=${ctxResult.text?.length}, page=${ctxResult.pageNumber}`);

  const ctxInfo: ContextInfo = {
    text: ctxResult.text,
    source: ctxResult.source,
    pageNumber: ctxResult.pageNumber,
  };

  const aiQuestion = refText
    ? `> ${refText.replace(/\n/g, "\n> ")}\n\n${question}`
    : question;
  const promptMsgs = askPrompt(aiQuestion, ctxInfo);
  const history = sessions
    .slice(0, -2)
    .map((m: ChatMessage) => ({ role: m.role, content: m.content }));
  const messages = [
    promptMsgs[0],
    ...history,
    promptMsgs[1],
  ] as any;
  ztoolkit.log(`[Agent] final messages count=${messages.length}, system=${promptMsgs[0].content.substring(0, 80)}...`);

  try {
    let lastRefresh = 0;
    await AIService.chat(messages, {
      stream: true,
      onRequest: (xhr) => { activeXHR = xhr; },
      onChunk: (state) => {
        assistant.content = state.content;
        assistant.reasoning = state.reasoning;
        const now = Date.now();
        if (now - lastRefresh > 150) {
          lastRefresh = now;
          updateStreamingMessage(body, state);
        }
      },
    });
  } catch (e: any) {
    if (!assistant.content && !assistant.reasoning) {
      assistant.content = `[Error] ${e?.message || String(e)}`;
    }
  }
  chatStore.touchSession(itemId, mode);
  setGenerating(body, false);
  renderMessages(body, itemId);
}

// ===================== Rendering =====================

function getModelLabel(): string {
  const svc = getActiveService();
  return svc ? svc.model : "AI";
}

async function copyTextToClipboard(doc: Document, text: string): Promise<boolean> {
  if (!text) return false;
  try {
    const navClipboard = (doc.defaultView as any)?.navigator?.clipboard;
    if (navClipboard?.writeText) {
      await navClipboard.writeText(text);
      return true;
    }
  } catch (_e) {
    // fallback below
  }
  try {
    const ta = doc.createElementNS("http://www.w3.org/1999/xhtml", "textarea") as HTMLTextAreaElement;
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    doc.documentElement.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = (doc as any).execCommand?.("copy");
    ta.remove();
    return Boolean(ok);
  } catch (_e) {
    return false;
  }
}

function createAssistantCopyButton(doc: Document): HTMLButtonElement {
  const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
  btn.className = "zoteroagent-copy-button";
  btn.textContent = "Copy";
  btn.title = "Copy assistant reply";
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const wrapper = (btn.closest(".zoteroagent-message.assistant") || null) as HTMLElement | null;
    const raw = wrapper?.dataset.rawContent || "";
    void copyTextToClipboard(doc, raw).then((ok) => {
      const original = btn.textContent || "Copy";
      btn.textContent = ok ? "Copied" : "Failed";
      setTimeout(() => {
        btn.textContent = original;
      }, 1200);
    });
  });
  return btn;
}

function updateStreamingMessage(
  body: HTMLElement,
  state: { content: string; reasoning: string },
) {
  try {
    const container = body.querySelector("#zoteroagent-chat-messages") as HTMLElement | null;
    if (!container) return;

    let msgWrapper = container.querySelector(
      ".zoteroagent-message.assistant:last-child",
    ) as HTMLElement | null;

    if (!msgWrapper) {
      const doc = body.ownerDocument;
      msgWrapper = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
      msgWrapper.className = "zoteroagent-message assistant";

      const roleRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      roleRow.className = "zoteroagent-role-row";
      const dot = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      dot.className = "zoteroagent-role-dot assistant";
      const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      label.className = "zoteroagent-role-label";
      label.textContent = getModelLabel();
      roleRow.appendChild(dot);
      roleRow.appendChild(label);
      msgWrapper.appendChild(roleRow);

      const inner = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      inner.className = "zoteroagent-message-content";
      msgWrapper.appendChild(inner);
      const actions = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      actions.className = "zoteroagent-message-actions";
      actions.appendChild(createAssistantCopyButton(doc));
      msgWrapper.appendChild(actions);
      container.appendChild(msgWrapper);
    }

    if (state.reasoning) {
      let thinkBlock = msgWrapper.querySelector(".zoteroagent-thinking") as HTMLElement | null;
      if (!thinkBlock) {
        const doc = body.ownerDocument;
        thinkBlock = doc.createElementNS("http://www.w3.org/1999/xhtml", "details") as HTMLElement;
        thinkBlock.className = "zoteroagent-thinking";
        const summary = doc.createElementNS("http://www.w3.org/1999/xhtml", "summary");
        summary.className = "zoteroagent-thinking-summary";
        thinkBlock.appendChild(summary);
        const thinkContent = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        thinkContent.className = "zoteroagent-thinking-content";
        thinkBlock.appendChild(thinkContent);
        const contentEl = msgWrapper.querySelector(".zoteroagent-message-content");
        if (contentEl) {
          msgWrapper.insertBefore(thinkBlock, contentEl);
        } else {
          msgWrapper.appendChild(thinkBlock);
        }
      }
      const summaryEl = thinkBlock.querySelector(".zoteroagent-thinking-summary");
      if (summaryEl) {
        const isThinking = !state.content;
        summaryEl.textContent = isThinking
          ? "Thinking..."
          : `Deeply thought`;
      }
      const thinkContentEl = thinkBlock.querySelector(".zoteroagent-thinking-content");
      if (thinkContentEl) thinkContentEl.textContent = state.reasoning;
    }

    const contentEl = msgWrapper.querySelector(".zoteroagent-message-content") as HTMLElement;
    if (contentEl) {
      try {
        contentEl.innerHTML = renderMarkdown(state.content);
      } catch (_e) {
        contentEl.textContent = state.content;
      }
    }
    msgWrapper.dataset.rawContent = state.content || "";

    container.scrollTop = container.scrollHeight;
  } catch (e) {
    ztoolkit.log("[Agent] updateStreamingMessage error:", e);
  }
}

function renderMessages(body: HTMLElement, itemId: number) {
  try {
    const container = body.querySelector("#zoteroagent-chat-messages") as HTMLElement | null;
    if (!container) return;
    const sessions = chatStore.getMessages(itemId);

    while (container.firstChild) {
      (container.firstChild as Element).remove();
    }

    const doc = body.ownerDocument;
    for (const msg of sessions) {
      const wrapper = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      wrapper.className = `zoteroagent-message ${msg.role === "user" ? "user" : "assistant"}`;

      const roleRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      roleRow.className = "zoteroagent-role-row";
      const dot = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      dot.className = `zoteroagent-role-dot ${msg.role === "user" ? "user" : "assistant"}`;
      const roleLabel = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      roleLabel.className = "zoteroagent-role-label";
      roleLabel.textContent = msg.role === "user" ? "You" : getModelLabel();
      roleRow.appendChild(dot);
      roleRow.appendChild(roleLabel);

      const inner = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      inner.className = "zoteroagent-message-content";

      wrapper.appendChild(roleRow);

      if (msg.role === "assistant") {
        if (msg.reasoning) {
          const thinkBlock = doc.createElementNS("http://www.w3.org/1999/xhtml", "details") as HTMLElement;
          thinkBlock.className = "zoteroagent-thinking";
          const summary = doc.createElementNS("http://www.w3.org/1999/xhtml", "summary");
          summary.className = "zoteroagent-thinking-summary";
          summary.textContent = "Deeply thought";
          thinkBlock.appendChild(summary);
          const thinkContent = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
          thinkContent.className = "zoteroagent-thinking-content";
          thinkContent.textContent = msg.reasoning;
          thinkBlock.appendChild(thinkContent);
          wrapper.appendChild(thinkBlock);
        }
        try {
          inner.innerHTML = renderMarkdown(msg.content);
        } catch (_e) {
          inner.textContent = msg.content;
        }
      } else {
        renderUserMessage(inner, msg.content);
      }

      if (msg.role === "assistant") {
        (wrapper as HTMLElement).dataset.rawContent = msg.content || "";
        wrapper.appendChild(inner);
        const actions = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        actions.className = "zoteroagent-message-actions";
        actions.appendChild(createAssistantCopyButton(doc));
        wrapper.appendChild(actions);
      } else {
        wrapper.appendChild(inner);
      }
      container.appendChild(wrapper);
    }

    syncSessionSelector(body, itemId);
    container.scrollTop = container.scrollHeight;
  } catch (e) {
    ztoolkit.log("[Agent] renderMessages error:", e);
  }
}

// ===================== Helpers =====================

function syncPrefill(body: HTMLElement) {
  if (addon.data.chat.prefillInput) {
    const input = body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null;
    if (input) {
      input.value = addon.data.chat.prefillInput;
      addon.data.chat.prefillInput = "";
    }
  }

  syncReferenceCard(body);

  if (addon.data.chat.referenceText || addon.data.chat.prefillInput) {
    body.dataset.chatMode = "chat";
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0) {
      syncLayoutState(body, itemId);
    }
    (body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null)?.focus();
  }
}

function syncReferenceCard(body: HTMLElement) {
  const card = body.querySelector("#zoteroagent-reference-card") as HTMLElement | null;
  if (!card) return;
  const text = addon.data.chat.referenceText;
  const content = card.querySelector(".zoteroagent-reference-content") as HTMLElement | null;
  if (text) {
    if (content) content.textContent = text;
    card.classList.remove("is-expanded");
    card.style.display = "flex";
  } else {
    if (content) content.textContent = "";
    card.style.display = "none";
  }
}

function syncContextSelector(body: HTMLElement, itemId?: number) {
  if (itemId && itemId > 0) {
    const session = chatStore.getSession(itemId);
    if (session) {
      addon.data.chat.contextMode = session.contextMode;
    }
  }
  const sel = body.querySelector("#zoteroagent-context-mode") as HTMLSelectElement | null;
  if (sel) sel.value = addon.data.chat.contextMode;
  const svcSel = body.querySelector("#zoteroagent-service-select") as HTMLSelectElement | null;
  if (svcSel) {
    populateServiceOptions(svcSel);
  }
}

function getItemTitle(itemId: number): string {
  try {
    const item = Zotero.Items.get(itemId) as any;
    return String(item?.getField?.("title") || item?.getDisplayTitle?.() || `Item ${itemId}`);
  } catch (_e) {
    return `Item ${itemId}`;
  }
}

function syncSessionSelector(body: HTMLElement, itemId: number) {
  const select = body.querySelector("#zoteroagent-session-select") as HTMLSelectElement | null;
  if (!select) return;
  while (select.firstChild) {
    select.firstChild.remove();
  }

  const sessionList = chatStore.listSessions(itemId);
  for (const s of sessionList) {
    const opt = select.ownerDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    opt.value = s.sessionId;
    opt.textContent = s.title;
    select.appendChild(opt);
  }
  if (sessionList.length === 0) {
    const fallback = select.ownerDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    fallback.value = "";
    fallback.textContent = `No chats for ${getItemTitle(itemId)}`;
    select.appendChild(fallback);
  }
  select.value = chatStore.getActiveSessionId(itemId);
}

function populateServiceOptions(select: HTMLSelectElement) {
  const services = loadServices();
  const activeId = getActiveServiceId();
  while (select.firstChild) select.firstChild.remove();
  if (services.length === 0) {
    const opt = select.ownerDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    opt.value = "";
    opt.textContent = "No service configured";
    select.appendChild(opt);
    return;
  }
  for (const svc of services) {
    const opt = select.ownerDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    opt.value = svc.id;
    opt.textContent = `${svc.name} / ${svc.model}`;
    select.appendChild(opt);
  }
  select.value = activeId || services[0]?.id || "";
}

function syncLayoutState(body: HTMLElement, itemId: number) {
  const sessions = chatStore.getMessages(itemId);
  const mode = body.dataset.chatMode || "welcome";
  const hasMessages = sessions.length > 0;
  const welcome = body.querySelector("#zoteroagent-chat-welcome") as HTMLElement | null;
  const sessionRow = body.querySelector("#zoteroagent-session-row") as HTMLElement | null;
  const messages = body.querySelector("#zoteroagent-chat-messages") as HTMLElement | null;
  const inputArea = body.querySelector("#zoteroagent-input-area") as HTMLElement | null;
  if (!welcome || !messages || !inputArea || !sessionRow) return;

  if (mode === "chat" || hasMessages) {
    welcome.style.display = "none";
    sessionRow.style.display = "flex";
    messages.style.display = "flex";
    messages.style.flexDirection = "column";
    inputArea.style.display = "flex";
  } else {
    welcome.style.display = "flex";
    sessionRow.style.display = "none";
    messages.style.display = "none";
    inputArea.style.display = "none";
  }
}

function renderUserMessage(container: HTMLElement, content: string) {
  const doc = container.ownerDocument;

  const selectedPrefix = "Selected Text: ";
  if (content.startsWith(selectedPrefix)) {
    const rest = content.slice(selectedPrefix.length);
    const doubleNewline = rest.indexOf("\n\n");
    const refText = doubleNewline >= 0 ? rest.slice(0, doubleNewline) : rest;
    const bodyText = doubleNewline >= 0 ? rest.slice(doubleNewline + 2).trim() : "";

    if (refText) {
      const refCard = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      refCard.className = "zoteroagent-msg-reference";

      const refLabel = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      refLabel.className = "zoteroagent-msg-ref-label";
      refLabel.textContent = "引用文本";

      const refTextEl = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      refTextEl.className = "zoteroagent-msg-ref-text";
      refTextEl.textContent = refText;

      const fade = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      fade.className = "zoteroagent-msg-ref-fade";

      refCard.appendChild(refLabel);
      refCard.appendChild(refTextEl);
      refCard.appendChild(fade);
      refCard.addEventListener("click", () => {
        refCard.classList.toggle("is-expanded");
      });
      container.appendChild(refCard);
    }
    if (bodyText) {
      const question = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      question.className = "zoteroagent-msg-question";
      question.textContent = bodyText;
      container.appendChild(question);
    }
    return;
  }

  const quoteLines: string[] = [];
  const bodyLines: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.trimStart().startsWith(">")) {
      quoteLines.push(line.replace(/^\s*>\s?/, ""));
    } else {
      bodyLines.push(line);
    }
  }
  if (quoteLines.length > 0) {
    const quote = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "blockquote",
    ) as HTMLQuoteElement;
    quote.className = "zoteroagent-user-quote";
    quote.textContent = quoteLines.join("\n");
    container.appendChild(quote);
  }
  const bodyText = bodyLines.join("\n").trim();
  if (bodyText) {
    const text = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    text.textContent = bodyText;
    container.appendChild(text);
  }
}
