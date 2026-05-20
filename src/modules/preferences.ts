import { config, homepage } from "../../package.json";
import { getString } from "../utils/locale";
import {
  loadServices,
  saveServices,
  getActiveServiceId,
  setActiveServiceId,
} from "../utils/services";
import { AIService } from "../services/ai-service";
import { PROVIDER_PRESETS, getPreset } from "../utils/provider-presets";
import type { ServiceProvider, ProviderKey, ApiFormat } from "../addon";

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
  bindServiceManager(doc);
}

function bindServiceManager(doc: Document) {
  const listContainer = doc.querySelector(
    `#${prefId("services-list")}`,
  ) as HTMLElement | null;
  const addBtn = doc.querySelector(`#${prefId("svcAdd")}`) as XUL.Button | null;
  const removeBtn = doc.querySelector(
    `#${prefId("svcRemove")}`,
  ) as XUL.Button | null;
  const defaultBtn = doc.querySelector(
    `#${prefId("svcDefault")}`,
  ) as XUL.Button | null;
  const saveBtn = doc.querySelector(
    `#${prefId("svcSave")}`,
  ) as XUL.Button | null;
  const testBtn = doc.querySelector(
    `#${prefId("svcTest")}`,
  ) as XUL.Button | null;

  const providerSelect = doc.querySelector(
    `#${prefId("svcProvider")}`,
  ) as HTMLSelectElement | null;
  const nameInput = doc.querySelector(
    `#${prefId("svcName")}`,
  ) as HTMLInputElement | null;
  const apiFormatSelect = doc.querySelector(
    `#${prefId("svcApiFormat")}`,
  ) as HTMLSelectElement | null;
  const urlInput = doc.querySelector(
    `#${prefId("svcApiUrl")}`,
  ) as HTMLInputElement | null;
  const keyInput = doc.querySelector(
    `#${prefId("svcApiKey")}`,
  ) as HTMLInputElement | null;
  const modelInput = doc.querySelector(
    `#${prefId("svcModel")}`,
  ) as HTMLInputElement | null;
  const miniModelInput = doc.querySelector(
    `#${prefId("svcMiniModel")}`,
  ) as HTMLInputElement | null;

  if (
    !listContainer ||
    !addBtn ||
    !removeBtn ||
    !defaultBtn ||
    !saveBtn ||
    !testBtn ||
    !providerSelect ||
    !nameInput ||
    !apiFormatSelect ||
    !urlInput ||
    !keyInput ||
    !modelInput ||
    !miniModelInput
  ) {
    return;
  }

  while (providerSelect.firstChild) providerSelect.firstChild.remove();
  for (const preset of PROVIDER_PRESETS) {
    const opt = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    opt.value = preset.key;
    opt.textContent = preset.label;
    providerSelect.appendChild(opt);
  }

  providerSelect.addEventListener("change", () => {
    const key = providerSelect.value as ProviderKey;
    const preset = getPreset(key);
    if (preset && key !== "custom") {
      nameInput.value = preset.label;
      urlInput.value = preset.apiUrl;
      modelInput.value = preset.defaultModel;
      miniModelInput.value = preset.miniModel || "";
      apiFormatSelect.value = preset.apiFormat;
    }
  });

  const renderList = () => {
    while (listContainer.firstChild) {
      listContainer.firstChild.remove();
    }
    const services = loadServices();
    const activeId = getActiveServiceId();

    for (const svc of services) {
      const row = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLDivElement;
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
        providerSelect.value = svc.provider || "custom";
        nameInput.value = svc.name;
        apiFormatSelect.value = svc.apiFormat || "chat-completions";
        urlInput.value = svc.apiUrl;
        keyInput.value = svc.apiKey;
        modelInput.value = svc.model;
        miniModelInput.value = svc.miniModel || "";
        renderList();
      });
      listContainer.appendChild(row);
    }

    if (services.length === 0) {
      const empty = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      empty.style.cssText =
        "padding:8px;font-size:12px;color:#888;text-align:center;";
      empty.textContent = getString("pref-svc-empty");
      listContainer.appendChild(empty);
    }
  };

  addBtn.addEventListener("command", () => {
    const services = loadServices();
    const id = `svc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const selectedProvider = providerSelect.value as ProviderKey;
    const preset = getPreset(selectedProvider);
    const newSvc: ServiceProvider = {
      id,
      name: preset?.label || "New Service",
      provider: selectedProvider,
      apiFormat:
        preset?.apiFormat ||
        (apiFormatSelect.value as ApiFormat) ||
        "chat-completions",
      apiUrl: preset?.apiUrl || "",
      apiKey: "",
      model: preset?.defaultModel || "",
      miniModel: preset?.miniModel || "",
    };
    services.push(newSvc);
    saveServices(services);
    if (services.length === 1) {
      setActiveServiceId(id);
    }
    selectedServiceId = id;
    providerSelect.value = newSvc.provider;
    nameInput.value = newSvc.name;
    apiFormatSelect.value = newSvc.apiFormat;
    urlInput.value = newSvc.apiUrl;
    keyInput.value = newSvc.apiKey;
    modelInput.value = newSvc.model;
    miniModelInput.value = newSvc.miniModel || "";
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
      providerSelect.value = svc.provider || "custom";
      nameInput.value = svc.name;
      apiFormatSelect.value = svc.apiFormat || "chat-completions";
      urlInput.value = svc.apiUrl;
      keyInput.value = svc.apiKey;
      modelInput.value = svc.model;
      miniModelInput.value = svc.miniModel || "";
    } else {
      providerSelect.value = "openai";
      nameInput.value = "";
      apiFormatSelect.value = "chat-completions";
      urlInput.value = "";
      keyInput.value = "";
      modelInput.value = "";
      miniModelInput.value = "";
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
    svc.provider = (providerSelect.value as ProviderKey) || "custom";
    svc.apiFormat = (apiFormatSelect.value as ApiFormat) || "chat-completions";
    svc.apiUrl = urlInput.value.trim();
    svc.apiKey = keyInput.value.trim();
    svc.model = modelInput.value.trim();
    svc.miniModel = miniModelInput.value.trim() || undefined;
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
    providerSelect.value = activeSvc.provider || "custom";
    nameInput.value = activeSvc.name;
    apiFormatSelect.value = activeSvc.apiFormat || "chat-completions";
    urlInput.value = activeSvc.apiUrl;
    keyInput.value = activeSvc.apiKey;
    modelInput.value = activeSvc.model;
    miniModelInput.value = activeSvc.miniModel || "";
  }
  renderList();
}
