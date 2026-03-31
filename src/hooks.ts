import { config } from "../package.json";
import { initLocale } from "./utils/locale";
import { registerPrefsWindow, registerPrefsScripts } from "./modules/preferences";
import { registerReaderInitializer } from "./modules/reader";
import { injectAgentPanel, removeAgentPanel, updateSidebarPanels } from "./modules/sidebar";
import { buildReaderPopup, updateReaderPopup } from "./modules/popup";
import { getPref } from "./utils/prefs";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  initLocale();
  ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.svg`,
  );
  addon.data.chat.contextMode = (getPref("defaultContextMode") as any) || "currentPage";
  registerPrefsWindow();
  registerReaderInitializer();
  await Promise.all(Zotero.getMainWindows().map((win) => onMainWindowLoad(win)));
}

async function onMainWindowLoad(win: Window): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  (win as any).MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);
  if (!win.document.querySelector(`#${config.addonRef}-panel-style`)) {
    const styleLink = win.document.createElement("link");
    styleLink.id = `${config.addonRef}-panel-style`;
    styleLink.setAttribute("rel", "stylesheet");
    styleLink.setAttribute(
      "href",
      `chrome://${config.addonRef}/content/styles/chat-panel.css`,
    );
    win.document.documentElement.appendChild(styleLink);
  }
  injectAgentPanel(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  removeAgentPanel(win);
  win.document.querySelector(`[href="${config.addonRef}-mainWindow.ftl"]`)?.remove();
  win.document.querySelector(`#${config.addonRef}-panel-style`)?.remove();
}

function onShutdown() {
  ztoolkit.unregisterAll();
  try {
    addon.data.panel.standaloneWindow?.close();
  } catch (_e) {
    // ignore
  }
  Zotero.getMainWindows().forEach((win) => {
    onMainWindowUnload(win);
  });
  addon.data.alive = false;
  // @ts-ignore Plugin instance is not typed
  delete Zotero[config.addonInstance];
}

function onPrefsLoad(event: Event) {
  registerPrefsScripts((event.target as any).ownerGlobal);
}

function onReaderPopupShow(
  event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
) {
  buildReaderPopup(event);
  updateReaderPopup();
}

function onReaderPopupRefresh() {
  updateReaderPopup();
}

function onSidebarPanelRefresh() {
  updateSidebarPanels();
}

export default {
  onStartup,
  onMainWindowLoad,
  onMainWindowUnload,
  onShutdown,
  onPrefsLoad,
  onReaderPopupShow,
  onReaderPopupRefresh,
  onSidebarPanelRefresh,
};
