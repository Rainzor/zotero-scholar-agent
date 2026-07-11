import { config, homepage } from "../../../package.json";
import { getString } from "../../utils/locale";
import { bindCodexSettings } from "./codex-section";
import { bindVaultSettings } from "./vault-section";
import { bindServiceManager } from "./services-section";

export function registerPrefsWindow() {
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: rootURI + "chrome/content/preferences.xhtml",
    label: getString("pref-title"),
    image: `chrome://${config.addonRef}/content/icons/favicon.svg`,
    helpURL: homepage,
  });
}

export function registerPrefsScripts(win: Window) {
  addon.data.prefs.window = win;
  const doc = win.document;
  const pane = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}`,
  ) as HTMLElement | null;
  if (!pane) return;
  if (pane.dataset.initialized === "true") return;
  pane.dataset.initializing = "true";
  win.setTimeout(() => {
    try {
      bindEvents(doc);
      pane.dataset.initialized = "true";
    } catch (e) {
      ztoolkit.log("[Agent] registerPrefsScripts error:", e);
    } finally {
      delete pane.dataset.initializing;
    }
  }, 0);
}

function bindEvents(doc: Document) {
  bindVaultSettings(doc);
  bindCodexSettings(doc);
  bindServiceManager(doc);
}
