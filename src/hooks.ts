import { config } from "../package.json";
import { initLocale } from "./utils/locale";
import {
  registerPrefsWindow,
  registerPrefsScripts,
} from "./modules/preferences";
import { registerReaderInitializer } from "./modules/reader";
import {
  registerAgentSection,
  unregisterAgentSection,
  updateSidebarPanels,
} from "./modules/sidebar";
import { buildReaderPopup, updateReaderPopup } from "./modules/popup";
import { chatStore } from "./services/chat-store";
import { coldStartQueue } from "./services/cold-start-queue";
import {
  registerBatchColdStartMenu,
  unregisterBatchColdStartMenu,
} from "./modules/batch-cold-start-menu";
let tabNotifierID: string | null = null;

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
  registerPrefsWindow();
  registerReaderInitializer();
  await chatStore.init();
  await coldStartQueue.init();
  registerAgentSection();

  try {
    tabNotifierID = Zotero.Notifier.registerObserver(
      {
        notify: (_event: string, _type: string) => {
          if (!addon.data.alive) return;
          setTimeout(() => {
            if (!addon.data.alive) return;
            updateSidebarPanels();
          }, 300);
        },
      },
      ["tab"],
      config.addonID,
    );
  } catch (_e) {
    /* tab notifier may not be available */
  }

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );
}

async function onMainWindowLoad(win: Window): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  (win as any).MozXULElement.insertFTLIfNeeded(
    `${config.addonRef}-mainWindow.ftl`,
  );
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
  if (!win.document.querySelector(`#${config.addonRef}-katex-style`)) {
    const katexLink = win.document.createElement("link");
    katexLink.id = `${config.addonRef}-katex-style`;
    katexLink.setAttribute("rel", "stylesheet");
    katexLink.setAttribute(
      "href",
      `chrome://${config.addonRef}/content/styles/katex.min.css`,
    );
    win.document.documentElement.appendChild(katexLink);
  }
  registerBatchColdStartMenu(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  try {
    if (Components.utils.isDeadWrapper(win)) return;
    win.document
      .querySelector(`[href="${config.addonRef}-mainWindow.ftl"]`)
      ?.remove();
    win.document.querySelector(`#${config.addonRef}-panel-style`)?.remove();
    win.document.querySelector(`#${config.addonRef}-katex-style`)?.remove();
    unregisterBatchColdStartMenu(win);
  } catch (_e) {
    // Window may already be destroyed
  }
}

async function onShutdown() {
  addon.data.alive = false;
  await coldStartQueue.pause();
  await chatStore.flushAll();
  if (tabNotifierID) {
    try {
      Zotero.Notifier.unregisterObserver(tabNotifierID);
    } catch (_e) {
      /* ignore */
    }
    tabNotifierID = null;
  }
  unregisterAgentSection();
  ztoolkit.unregisterAll();
  try {
    addon.data.panel.standaloneWindow?.close();
  } catch (_e) {
    // ignore
  }
  Zotero.getMainWindows().forEach((win) => {
    onMainWindowUnload(win);
  });
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
