import type { ContextMode } from "./addon";
import { showAgentPanel, syncReferenceCardDirect, updateSidebarPanels } from "./modules/sidebar";
import { chatStore } from "./services/chat-store";

function refreshPanels() {
  updateSidebarPanels();
}

function setPrefillInput(text: string, _mode?: ContextMode) {
  addon.data.chat.prefillInput = text;
  showAgentPanel();
  updateSidebarPanels();
}

function setReferenceText(text: string, pageLabel?: string) {
  addon.data.chat.referenceText = formatReferenceText(text, pageLabel);
  showAgentPanel();
  syncReferenceCardDirect();
}

function clearReferenceText() {
  addon.data.chat.referenceText = "";
  updateSidebarPanels();
}

function getMessages(itemId: number) {
  return chatStore.getMessages(itemId);
}

function getSession(itemId: number) {
  return chatStore.getSession(itemId);
}

function listSessions(itemId: number) {
  return chatStore.listSessions(itemId);
}

function createSession(itemId: number, title?: string, mode?: ContextMode) {
  return chatStore.createSession(itemId, title, mode || "agent");
}

function setActiveSession(itemId: number, sessionId: string) {
  chatStore.setActiveSession(itemId, sessionId);
  refreshPanels();
}

function renameSession(itemId: number, title: string, sessionId?: string) {
  chatStore.renameSession(itemId, title, sessionId);
  refreshPanels();
}

async function deleteSession(itemId: number, sessionId?: string) {
  await chatStore.deleteSession(itemId, sessionId);
  refreshPanels();
}

function resetMessages(itemId: number) {
  chatStore.clearSession(itemId);
  refreshPanels();
}

export default {
  refreshPanels,
  setPrefillInput,
  setReferenceText,
  clearReferenceText,
  getMessages,
  getSession,
  listSessions,
  createSession,
  setActiveSession,
  renameSession,
  deleteSession,
  resetMessages,
};

function formatReferenceText(text: string, pageLabel?: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  const safePageLabel = String(pageLabel || "").trim();
  if (!safePageLabel) return trimmed;
  return `[Quote|page=${safePageLabel}]\n${trimmed}`;
}
