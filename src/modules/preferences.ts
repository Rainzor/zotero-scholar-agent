import { config, homepage } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import {
  loadServices,
  saveServices,
  getActiveServiceId,
  setActiveServiceId,
} from "../utils/services";
import { AIService } from "../services/ai-service";
import type { ServiceProvider } from "../addon";

function prefId(key: string) {
  return `${config.addonRef}-${key}`;
}

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

let selectedServiceId = "";

function bindEvents(doc: Document) {
  const contextMode = doc.querySelector(
    `#${prefId("defaultContextMode")}`,
  ) as XUL.MenuList | undefined;
  contextMode?.addEventListener("command", () => {
    const value = contextMode.getAttribute("value") || "currentPage";
    setPref("defaultContextMode", value);
    addon.data.chat.contextMode = value as any;
  });

  addon.data.chat.contextMode =
    (getPref("defaultContextMode") as any) || "currentPage";

  bindServiceManager(doc);
}

function bindServiceManager(doc: Document) {
  const listContainer = doc.querySelector(
    `#${prefId("services-list")}`,
  ) as HTMLElement | null;
  const addBtn = doc.querySelector(`#${prefId("svcAdd")}`) as XUL.Button | null;
  const removeBtn = doc.querySelector(`#${prefId("svcRemove")}`) as XUL.Button | null;
  const defaultBtn = doc.querySelector(`#${prefId("svcDefault")}`) as XUL.Button | null;
  const saveBtn = doc.querySelector(`#${prefId("svcSave")}`) as XUL.Button | null;
  const testBtn = doc.querySelector(`#${prefId("svcTest")}`) as XUL.Button | null;

  const nameInput = doc.querySelector(`#${prefId("svcName")}`) as HTMLInputElement | null;
  const urlInput = doc.querySelector(`#${prefId("svcApiUrl")}`) as HTMLInputElement | null;
  const keyInput = doc.querySelector(`#${prefId("svcApiKey")}`) as HTMLInputElement | null;
  const modelInput = doc.querySelector(`#${prefId("svcModel")}`) as HTMLInputElement | null;

  if (
    !listContainer || !addBtn || !removeBtn || !defaultBtn ||
    !saveBtn || !testBtn || !nameInput || !urlInput || !keyInput || !modelInput
  ) {
    return;
  }

  const renderList = () => {
    while (listContainer.firstChild) {
      listContainer.firstChild.remove();
    }
    const services = loadServices();
    const activeId = getActiveServiceId();

    for (const svc of services) {
      const row = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLDivElement;
      row.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;cursor:pointer;";
      if (svc.id === selectedServiceId) {
        row.style.background = "#d0e4ff";
      }

      const isDefault = svc.id === activeId;
      const badge = isDefault ? " ★" : "";
      const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      label.style.cssText = "flex:1;font-size:12px;user-select:none;";
      label.textContent = `${svc.name}${badge}  —  ${svc.model}`;
      if (isDefault) {
        label.style.fontWeight = "600";
      }

      row.appendChild(label);
      row.addEventListener("click", () => {
        selectedServiceId = svc.id;
        nameInput.value = svc.name;
        urlInput.value = svc.apiUrl;
        keyInput.value = svc.apiKey;
        modelInput.value = svc.model;
        renderList();
      });
      listContainer.appendChild(row);
    }

    if (services.length === 0) {
      const empty = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      empty.style.cssText = "padding:8px;font-size:12px;color:#888;text-align:center;";
      empty.textContent = getString("pref-svc-empty");
      listContainer.appendChild(empty);
    }
  };

  addBtn.addEventListener("command", () => {
    const services = loadServices();
    const id = `svc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newSvc: ServiceProvider = {
      id,
      name: "New Service",
      apiUrl: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      model: "gpt-4o-mini",
    };
    services.push(newSvc);
    saveServices(services);
    if (services.length === 1) {
      setActiveServiceId(id);
    }
    selectedServiceId = id;
    nameInput.value = newSvc.name;
    urlInput.value = newSvc.apiUrl;
    keyInput.value = newSvc.apiKey;
    modelInput.value = newSvc.model;
    renderList();
  });

  removeBtn.addEventListener("command", () => {
    if (!selectedServiceId) return;
    let services = loadServices();
    services = services.filter((s) => s.id !== selectedServiceId);
    saveServices(services);
    if (getActiveServiceId() === selectedServiceId) {
      setActiveServiceId(services[0]?.id || "");
    }
    selectedServiceId = services[0]?.id || "";
    const svc = services[0];
    if (svc) {
      nameInput.value = svc.name;
      urlInput.value = svc.apiUrl;
      keyInput.value = svc.apiKey;
      modelInput.value = svc.model;
    } else {
      nameInput.value = "";
      urlInput.value = "";
      keyInput.value = "";
      modelInput.value = "";
    }
    renderList();
  });

  defaultBtn.addEventListener("command", () => {
    if (!selectedServiceId) return;
    setActiveServiceId(selectedServiceId);
    renderList();
    const progress = new ztoolkit.ProgressWindow(config.addonName, {
      closeOtherProgressWindows: true,
      closeOnClick: true,
    })
      .createLine({ text: getString("pref-svc-defaultSet"), type: "success" })
      .show();
    progress.startCloseTimer(2000);
  });

  saveBtn.addEventListener("command", () => {
    if (!selectedServiceId) return;
    const services = loadServices();
    const svc = services.find((s) => s.id === selectedServiceId);
    if (!svc) return;
    svc.name = nameInput.value.trim() || "Untitled";
    svc.apiUrl = urlInput.value.trim();
    svc.apiKey = keyInput.value.trim();
    svc.model = modelInput.value.trim();
    saveServices(services);
    renderList();
    const progress = new ztoolkit.ProgressWindow(config.addonName, {
      closeOtherProgressWindows: true,
      closeOnClick: true,
    })
      .createLine({ text: getString("pref-svc-saved"), type: "success" })
      .show();
    progress.startCloseTimer(1500);
  });

  testBtn.addEventListener("command", async () => {
    const progress = new ztoolkit.ProgressWindow(config.addonName, {
      closeOtherProgressWindows: true,
      closeOnClick: true,
    })
      .createLine({ text: getString("pref-testApi-running"), type: "default" })
      .show();
    try {
      await AIService.chat(
        [{ role: "user", content: "Reply with exactly: OK" }],
        { stream: false },
      );
      progress.changeLine({
        idx: 0,
        text: getString("pref-testApi-success"),
        type: "success",
      });
    } catch (e: any) {
      progress.changeLine({
        idx: 0,
        text: `${getString("pref-testApi-fail")}: ${e?.message || String(e)}`,
        type: "fail",
      });
    }
    progress.startCloseTimer(4000);
  });

  const services = loadServices();
  selectedServiceId = getActiveServiceId() || services[0]?.id || "";
  const activeSvc = services.find((s) => s.id === selectedServiceId);
  if (activeSvc) {
    nameInput.value = activeSvc.name;
    urlInput.value = activeSvc.apiUrl;
    keyInput.value = activeSvc.apiKey;
    modelInput.value = activeSvc.model;
  }
  renderList();
}
