import { getString } from "../../utils/locale";
import { debounce, type Debounced } from "../../utils/debounce";
import { loadServices, saveServices } from "../../utils/services";
import { getPreset } from "../../utils/provider-presets";
import type { ServiceConfig } from "../../services/ai-service";
import type { ServiceProvider, ProviderKey, ApiFormat } from "../../addon";
import { prefId } from "./ids";
import { setSectionStatus } from "./status";

const SAVE_DELAY_MS = 500;

export type ServiceEditorElements = {
  providerSelect: HTMLSelectElement;
  nameInput: HTMLInputElement;
  apiFormatSelect: HTMLSelectElement;
  urlInput: HTMLInputElement;
  keyInput: HTMLInputElement;
  keyToggleBtn: XUL.Button;
  modelInput: HTMLInputElement;
  miniModelInput: HTMLInputElement;
};

export function queryServiceEditorElements(
  doc: Document,
): ServiceEditorElements | null {
  const els = {
    providerSelect: doc.querySelector(`#${prefId("svcProvider")}`),
    nameInput: doc.querySelector(`#${prefId("svcName")}`),
    apiFormatSelect: doc.querySelector(`#${prefId("svcApiFormat")}`),
    urlInput: doc.querySelector(`#${prefId("svcApiUrl")}`),
    keyInput: doc.querySelector(`#${prefId("svcApiKey")}`),
    keyToggleBtn: doc.querySelector(`#${prefId("svcApiKeyToggle")}`),
    modelInput: doc.querySelector(`#${prefId("svcModel")}`),
    miniModelInput: doc.querySelector(`#${prefId("svcMiniModel")}`),
  };
  return Object.values(els).some((el) => !el)
    ? null
    : (els as ServiceEditorElements);
}

export function populateServiceEditor(
  els: ServiceEditorElements,
  svc: ServiceProvider,
): void {
  els.providerSelect.value = svc.provider || "custom";
  els.nameInput.value = svc.name;
  els.apiFormatSelect.value = svc.apiFormat || "chat-completions";
  els.urlInput.value = svc.apiUrl;
  els.keyInput.value = svc.apiKey;
  els.modelInput.value = svc.model;
  els.miniModelInput.value = svc.miniModel || "";
}

export function clearServiceEditor(els: ServiceEditorElements): void {
  els.providerSelect.value = "openai";
  els.nameInput.value = "";
  els.apiFormatSelect.value = "chat-completions";
  els.urlInput.value = "";
  els.keyInput.value = "";
  els.modelInput.value = "";
  els.miniModelInput.value = "";
}

function readServiceEditor(
  els: ServiceEditorElements,
  id: string,
): ServiceProvider {
  return {
    id,
    name: els.nameInput.value.trim() || "Untitled",
    provider: (els.providerSelect.value as ProviderKey) || "custom",
    apiFormat: (els.apiFormatSelect.value as ApiFormat) || "chat-completions",
    apiUrl: els.urlInput.value.trim(),
    apiKey: els.keyInput.value.trim(),
    model: els.modelInput.value.trim(),
    miniModel: els.miniModelInput.value.trim() || undefined,
  };
}

export function buildLiveServiceConfig(
  els: ServiceEditorElements,
): ServiceConfig {
  const provider = (els.providerSelect.value as ProviderKey) || "custom";
  const preset = getPreset(provider);
  return {
    apiUrl: els.urlInput.value.trim(),
    apiKey: els.keyInput.value.trim(),
    model: els.modelInput.value.trim(),
    provider,
    apiFormat:
      (els.apiFormatSelect.value as ApiFormat) ||
      preset?.apiFormat ||
      "chat-completions",
    authType: preset?.authType || "bearer",
  };
}

export function bindServiceEditorEvents(
  els: ServiceEditorElements,
  statusEl: HTMLElement,
  getSelectedId: () => string,
  onPersisted: () => void,
): Debounced<[]> {
  const persist = debounce(() => {
    const id = getSelectedId();
    if (!id) return;
    const services = loadServices();
    const idx = services.findIndex((s) => s.id === id);
    if (idx === -1) return;
    services[idx] = readServiceEditor(els, id);
    saveServices(services);
    setSectionStatus(statusEl, "saved", getString("pref-svc-saved"));
    onPersisted();
  }, SAVE_DELAY_MS);

  const commit = () => {
    setSectionStatus(statusEl, "saving", getString("pref-svc-saving"));
    persist();
  };

  for (const el of [
    els.nameInput,
    els.urlInput,
    els.keyInput,
    els.modelInput,
    els.miniModelInput,
  ]) {
    el.addEventListener("input", commit);
  }
  els.apiFormatSelect.addEventListener("change", commit);
  els.providerSelect.addEventListener("change", () => {
    const key = els.providerSelect.value as ProviderKey;
    const preset = getPreset(key);
    if (preset && key !== "custom") {
      els.nameInput.value = preset.label;
      els.urlInput.value = preset.apiUrl;
      els.modelInput.value = preset.defaultModel;
      els.miniModelInput.value = preset.miniModel || "";
      els.apiFormatSelect.value = preset.apiFormat;
    }
    commit();
  });

  els.keyToggleBtn.addEventListener("command", () => {
    const isHidden = els.keyInput.type === "password";
    els.keyInput.type = isHidden ? "text" : "password";
    els.keyToggleBtn.setAttribute(
      "data-l10n-id",
      isHidden ? "pref-svc-apiKey-hide" : "pref-svc-apiKey-show",
    );
  });

  return persist;
}
