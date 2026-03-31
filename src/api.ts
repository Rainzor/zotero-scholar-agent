import { ContextMode } from "./addon";
import { showAgentPanel, updateSidebarPanels } from "./modules/sidebar";

function refreshPanels() {
  updateSidebarPanels();
}

function setPrefillInput(text: string, mode?: ContextMode) {
  addon.data.chat.prefillInput = text;
  if (mode) {
    addon.data.chat.contextMode = mode;
  }
  showAgentPanel();
}

function getMessages(itemId: number) {
  if (!addon.data.chat.sessions[itemId]) {
    addon.data.chat.sessions[itemId] = [];
  }
  return addon.data.chat.sessions[itemId];
}

function resetMessages(itemId: number) {
  addon.data.chat.sessions[itemId] = [];
  refreshPanels();
}

export default {
  refreshPanels,
  setPrefillInput,
  getMessages,
  resetMessages,
};
