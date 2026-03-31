import { config } from "../../package.json";
import { getLocaleID } from "../utils/locale";
import { renderMarkdown } from "../utils/markdown";
import { AIService } from "../services/ai-service";
import { askPrompt, summarizePrompt } from "../services/prompts";
import { getContextByMode, getFullText } from "./pdf-context";
import { loadServices, getActiveServiceId, setActiveServiceId } from "../utils/services";
import type { ChatMessage, ContextMode } from "../addon";

let agentPanel: Element | null = null;
let agentRoot: HTMLElement | null = null;
let agentSidenavBtn: Element | null = null;
let agentSidenavDivider: Element | null = null;
let notifierID: string | null = null;

export function injectAgentPanel(win: Window) {
  try {
    const doc = win.document;
    const deck = doc.getElementById("zotero-context-pane-deck") as any;
    if (!deck) return;

    agentPanel = doc.createXULElement("vbox");
    agentPanel.id = "zoteroagent-context-panel";
    agentPanel.setAttribute("flex", "1");
    deck.appendChild(agentPanel);

    agentRoot = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    agentRoot.id = "zoteroagent-context-root";
    agentRoot.style.cssText = "height:100%;overflow:hidden;";
    agentPanel.appendChild(agentRoot);

    ensureChatUI(agentRoot);

    const sidenav = doc.querySelector("item-pane-sidenav") as any;
    if (sidenav) {
      injectSidenavButton(doc, sidenav, deck);
      interceptSidenavClicks(sidenav, deck);
    }

    notifierID = Zotero.Notifier.registerObserver(
      {
        notify: (action: string, type: string, ids: string[] | number[]) => {
          try {
            if (type === "tab" && ["select", "load"].includes(action)) {
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

export function removeAgentPanel(win: Window) {
  try {
    if (notifierID) {
      Zotero.Notifier.unregisterObserver(notifierID);
      notifierID = null;
    }
    agentPanel?.remove();
    agentPanel = null;
    agentRoot = null;
    agentSidenavBtn?.remove();
    agentSidenavBtn = null;
    agentSidenavDivider?.remove();
    agentSidenavDivider = null;
  } catch (_e) {
    // ignore
  }
}

export function updateSidebarPanels() {
  try {
    if (agentRoot && isAgentPanelVisible()) {
      refreshAgentContent();
      syncPrefill(agentRoot);
    }
  } catch (_e) {
    // ignore
  }
}

export function showAgentPanel() {
  try {
    if (!agentPanel || !agentRoot) return;
    const deck = agentPanel.parentElement as any;
    if (!deck) return;
    deck.selectedPanel = agentPanel;
    updateSidenavHighlight(true);
    refreshAgentContent();
    syncPrefill(agentRoot);
  } catch (_e) {
    // ignore
  }
}

function injectSidenavButton(doc: Document, sidenav: Element, _deck: any) {
  agentSidenavDivider = doc.createElement("div");
  agentSidenavDivider.classList.add("divider");
  agentSidenavDivider.id = "zoteroagent-sidenav-divider";

  const wrapper = doc.createElement("div");
  wrapper.classList.add("pin-wrapper");
  wrapper.id = "zoteroagent-sidenav-wrapper";

  const btn = doc.createXULElement("div") as any;
  btn.classList.add("btn");
  btn.id = "zoteroagent-sidenav-btn";
  btn.setAttribute("custom", "true");
  btn.setAttribute("tooltiptext", "Agent Chat");
  btn.style.cssText = `
    --custom-sidenav-icon-light: url('chrome://${config.addonRef}/content/icons/section-20.svg');
    --custom-sidenav-icon-dark: url('chrome://${config.addonRef}/content/icons/section-20.svg');
  `;

  wrapper.appendChild(btn);
  agentSidenavBtn = wrapper;

  const togglePaneBtn = sidenav.querySelector(
    '.btn[data-action="toggle-pane"]',
  );
  if (togglePaneBtn?.parentElement) {
    togglePaneBtn.parentElement.before(agentSidenavDivider, wrapper);
  } else {
    sidenav.appendChild(agentSidenavDivider);
    sidenav.appendChild(wrapper);
  }

  btn.addEventListener("click", (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const deck = agentPanel?.parentElement as any;
    if (!deck || !agentPanel) return;

    if (deck.selectedPanel === agentPanel) {
      switchBackToItemDetails(deck);
    } else {
      deck.selectedPanel = agentPanel;
      updateSidenavHighlight(true);
      refreshAgentContent();
    }
  });
}

function interceptSidenavClicks(sidenav: Element, deck: any) {
  sidenav.addEventListener(
    "click",
    (e: Event) => {
      try {
        const target = e.target as HTMLElement;
        if (!target?.classList?.contains("btn")) return;
        if (target.id === "zoteroagent-sidenav-btn") return;
        if (deck.selectedPanel === agentPanel) {
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
  const btn = agentSidenavBtn?.querySelector("#zoteroagent-sidenav-btn");
  if (!btn) return;
  if (active) {
    (btn as HTMLElement).style.setProperty("opacity", "1");
    (btn as HTMLElement).style.setProperty("background", "var(--fill-quinary, rgba(0,0,0,0.06))");
    (btn as HTMLElement).style.setProperty("border-radius", "4px");
  } else {
    (btn as HTMLElement).style.removeProperty("opacity");
    (btn as HTMLElement).style.removeProperty("background");
    (btn as HTMLElement).style.removeProperty("border-radius");
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

function refreshAgentContent() {
  if (!agentRoot) return;
  const reader = Zotero.Reader?.getByTabID?.(
    (Zotero as any).getActiveZoteroPane?.()?.getSelectedTabID?.() ||
      (typeof Zotero_Tabs !== "undefined"
        ? (Zotero_Tabs as any).selectedID
        : ""),
  );
  const itemId = reader?._item?.id || 0;

  if (itemId > 0) {
    agentRoot.dataset.itemID = String(itemId);
    addon.data.popup.currentReader = reader;
    if (!addon.data.chat.sessions[itemId]) {
      addon.data.chat.sessions[itemId] = [];
    }
    renderMessages(agentRoot, itemId);
    syncContextSelector(agentRoot);
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

  const inputArea = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  inputArea.id = "zoteroagent-input-area";
  inputArea.className = "zoteroagent-input-area";

  const inputRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  inputRow.id = "zoteroagent-chat-input-row";
  inputRow.className = "zoteroagent-chat-input-row";

  const textarea = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "textarea",
  ) as HTMLTextAreaElement;
  textarea.id = "zoteroagent-chat-input";
  textarea.rows = 3;
  textarea.placeholder = "提出问题，AI将基于上下文回答";

  const sendBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  sendBtn.id = "zoteroagent-chat-send";
  sendBtn.className = "zoteroagent-send-button";
  sendBtn.textContent = "发送";

  inputRow.appendChild(textarea);
  inputRow.appendChild(sendBtn);

  const controlsRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  controlsRow.id = "zoteroagent-controls-row";
  controlsRow.className = "zoteroagent-controls-row";

  const serviceSelect = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  serviceSelect.id = "zoteroagent-service-select";
  serviceSelect.className = "zoteroagent-service-select";
  populateServiceOptions(serviceSelect);

  const contextSelect = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  contextSelect.id = "zoteroagent-context-mode";
  contextSelect.className = "zoteroagent-context-select";
  for (const [val, text] of [
    ["none", "一般对话"],
    ["selectedText", "选中段落"],
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

  controlsRow.appendChild(serviceSelect);
  controlsRow.appendChild(contextSelect);
  controlsRow.appendChild(clearBtn);
  inputArea.appendChild(controlsRow);
  inputArea.appendChild(inputRow);

  container.appendChild(welcome);
  container.appendChild(messagesDiv);
  container.appendChild(inputArea);
  body.appendChild(container);

  bindChatEvents(body);
}

function bindChatEvents(body: HTMLElement) {
  body.querySelector("#zoteroagent-mode-analyze")?.addEventListener("click", () => {
    body.dataset.chatMode = "chat";
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0) {
      syncLayoutState(body, itemId);
      void analyzePaper(body, itemId);
    }
  });
  body.querySelector("#zoteroagent-mode-chat")?.addEventListener("click", () => {
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
      addon.data.chat.sessions[itemId] = [];
      renderMessages(body, itemId);
      syncLayoutState(body, itemId);
    }
  });
  body.querySelector("#zoteroagent-context-mode")?.addEventListener("change", (event) => {
    addon.data.chat.contextMode = (event.target as HTMLSelectElement).value as ContextMode;
  });
  body.querySelector("#zoteroagent-service-select")?.addEventListener("change", (event) => {
    const id = (event.target as HTMLSelectElement).value;
    if (id) setActiveServiceId(id);
  });
}

// ===================== AI Logic =====================

async function analyzePaper(body: HTMLElement, itemId: number) {
  const sessions = addon.api.getMessages(itemId);
  sessions.push({ role: "user", content: "分析这篇论文的核心内容、方法和局限性。" });
  const assistant: ChatMessage = { role: "assistant", content: "" };
  sessions.push(assistant);
  renderMessages(body, itemId);
  syncLayoutState(body, itemId);
  try {
    const fullText = await getFullText(itemId);
    if (!fullText) {
      assistant.content = "未读取到全文内容，请确认当前附件是可读的 PDF。";
      renderMessages(body, itemId);
      return;
    }
    let lastRefresh = 0;
    await AIService.chat(summarizePrompt(fullText) as any, {
      stream: true,
      onChunk: (_chunk, fullTextResult) => {
        assistant.content = fullTextResult;
        const now = Date.now();
        if (now - lastRefresh > 150) {
          lastRefresh = now;
          updateStreamingMessage(body, fullTextResult);
        }
      },
    });
  } catch (e: any) {
    assistant.content = `[Error] ${e?.message || String(e)}`;
  }
  renderMessages(body, itemId);
}

async function submitQuestion(body: HTMLElement) {
  const input = body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null;
  if (!input) return;
  const question = input.value.trim();
  if (!question) return;

  const itemId = Number(body.dataset.itemID);
  if (!itemId || itemId < 0) return;

  const sessions = addon.api.getMessages(itemId);
  sessions.push({ role: "user", content: question });
  input.value = "";
  body.dataset.chatMode = "chat";
  syncLayoutState(body, itemId);

  const assistant: ChatMessage = { role: "assistant", content: "" };
  sessions.push(assistant);
  renderMessages(body, itemId);

  const reader = addon.data.popup.currentReader;
  const mode = addon.data.chat.contextMode;
  const context = await getContextByMode({
    mode,
    reader,
    itemId,
    selectedText: addon.data.popup.selectedText,
  });

  const messages = [
    ...sessions.slice(0, -1).map((m: ChatMessage) => ({ role: m.role, content: m.content })),
    ...askPrompt(question, context),
  ] as any;

  try {
    let lastRefresh = 0;
    await AIService.chat(messages, {
      stream: true,
      onChunk: (_chunk, fullText) => {
        assistant.content = fullText;
        const now = Date.now();
        if (now - lastRefresh > 150) {
          lastRefresh = now;
          updateStreamingMessage(body, fullText);
        }
      },
    });
  } catch (e: any) {
    assistant.content = `[Error] ${e?.message || String(e)}`;
  }
  renderMessages(body, itemId);
}

// ===================== Rendering =====================

function updateStreamingMessage(body: HTMLElement, text: string) {
  try {
    const container = body.querySelector("#zoteroagent-chat-messages") as HTMLElement | null;
    if (!container) return;
    let lastMsg = container.querySelector(
      ".zoteroagent-message.assistant:last-child .zoteroagent-message-content",
    ) as HTMLElement | null;
    if (!lastMsg) {
      const doc = body.ownerDocument;
      const wrapper = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      wrapper.className = "zoteroagent-message assistant";

      const roleRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      roleRow.className = "zoteroagent-role-row";
      const dot = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      dot.className = "zoteroagent-role-dot assistant";
      const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      label.className = "zoteroagent-role-label";
      label.textContent = "AI";
      roleRow.appendChild(dot);
      roleRow.appendChild(label);

      const inner = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      inner.className = "zoteroagent-message-content";
      wrapper.appendChild(roleRow);
      wrapper.appendChild(inner);
      container.appendChild(wrapper);
      lastMsg = inner;
    }
    lastMsg.textContent = text;
    container.scrollTop = container.scrollHeight;
  } catch (e) {
    ztoolkit.log("[Agent] updateStreamingMessage error:", e);
  }
}

function renderMessages(body: HTMLElement, itemId: number) {
  try {
    const container = body.querySelector("#zoteroagent-chat-messages") as HTMLElement | null;
    if (!container) return;
    const sessions = addon.data.chat.sessions[itemId] || [];

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
      roleLabel.textContent = msg.role === "user" ? "You" : "AI";
      roleRow.appendChild(dot);
      roleRow.appendChild(roleLabel);

      const inner = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      inner.className = "zoteroagent-message-content";

      if (msg.role === "assistant") {
        try {
          inner.innerHTML = renderMarkdown(msg.content);
        } catch (_e) {
          inner.textContent = msg.content;
        }
      } else {
        renderUserMessage(inner, msg.content);
      }

      wrapper.appendChild(roleRow);
      wrapper.appendChild(inner);
      container.appendChild(wrapper);
    }

    container.scrollTop = container.scrollHeight;
  } catch (e) {
    ztoolkit.log("[Agent] renderMessages error:", e);
  }
}

// ===================== Helpers =====================

function syncPrefill(body: HTMLElement) {
  if (!addon.data.chat.prefillInput) return;
  const input = body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null;
  if (input) {
    input.value = addon.data.chat.prefillInput;
    addon.data.chat.prefillInput = "";
    body.dataset.chatMode = "chat";
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0) {
      syncLayoutState(body, itemId);
    }
  }
}

function syncContextSelector(body: HTMLElement) {
  const sel = body.querySelector("#zoteroagent-context-mode") as HTMLSelectElement | null;
  if (sel) sel.value = addon.data.chat.contextMode;
  const svcSel = body.querySelector("#zoteroagent-service-select") as HTMLSelectElement | null;
  if (svcSel) {
    populateServiceOptions(svcSel);
  }
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
  const sessions = addon.data.chat.sessions[itemId] || [];
  const mode = body.dataset.chatMode || "welcome";
  const hasMessages = sessions.length > 0;
  const welcome = body.querySelector("#zoteroagent-chat-welcome") as HTMLElement | null;
  const messages = body.querySelector("#zoteroagent-chat-messages") as HTMLElement | null;
  const inputArea = body.querySelector("#zoteroagent-input-area") as HTMLElement | null;
  if (!welcome || !messages || !inputArea) return;

  if (mode === "chat" || hasMessages) {
    welcome.style.display = "none";
    messages.style.display = "block";
    inputArea.style.display = "flex";
  } else {
    welcome.style.display = "flex";
    messages.style.display = "none";
    inputArea.style.display = "none";
  }
}

function renderUserMessage(container: HTMLElement, content: string) {
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
  const doc = container.ownerDocument;
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
