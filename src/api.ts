import type { ContextMode } from "./addon";
import { showAgentPanel, updateSidebarPanels } from "./modules/sidebar";
import { chatStore } from "./services/chat-store";

function refreshPanels() {
  updateSidebarPanels();
}

function setPrefillInput(text: string, mode?: ContextMode) {
  addon.data.chat.prefillInput = text;
  if (mode) {
    addon.data.chat.contextMode = mode;
  }
  showAgentPanel();
  updateSidebarPanels();
}

function setReferenceText(text: string) {
  addon.data.chat.referenceText = text;
  showAgentPanel();
  updateSidebarPanels();
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
  return chatStore.createSession(itemId, title, mode || addon.data.chat.contextMode);
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
