import { getString } from "../../utils/locale";
import {
  loadServices,
  saveServices,
  getActiveServiceId,
  setActiveServiceId,
} from "../../utils/services";
import { AIService } from "../../services/ai-service";
import { getPreset } from "../../utils/provider-presets";
import type { ServiceProvider, ProviderKey, ApiFormat } from "../../addon";
import { prefId } from "./ids";
import { setSectionStatus } from "./status";
import { renderServiceList } from "./services-list";
import {
  bindServiceEditorEvents,
  buildLiveServiceConfig,
  clearServiceEditor,
  populateServiceEditor,
  queryServiceEditorElements,
} from "./services-editor";

export function bindServiceManager(doc: Document): void {
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
  const testBtn = doc.querySelector(
    `#${prefId("svcTest")}`,
  ) as XUL.Button | null;
  const statusEl = doc.querySelector(
    `#${prefId("svcStatus")}`,
  ) as HTMLElement | null;
  const removeConfirm = doc.querySelector(
    `#${prefId("svcRemoveConfirm")}`,
  ) as HTMLElement | null;
  const removeConfirmCancel = doc.querySelector(
    `#${prefId("svcRemoveConfirmCancel")}`,
  ) as XUL.Button | null;
  const removeConfirmAction = doc.querySelector(
    `#${prefId("svcRemoveConfirmAction")}`,
  ) as XUL.Button | null;
  const els = queryServiceEditorElements(doc);
  if (
    !listContainer ||
    !addBtn ||
    !removeBtn ||
    !defaultBtn ||
    !testBtn ||
    !statusEl ||
    !removeConfirm ||
    !removeConfirmCancel ||
    !removeConfirmAction ||
    !els
  )
    return;

  let selectedServiceId = "";
  const renderList = () =>
    renderServiceList(doc, listContainer, selectedServiceId, selectService);

  const persistEditor = bindServiceEditorEvents(
    els,
    statusEl,
    () => selectedServiceId,
    renderList,
  );

  function selectService(id: string) {
    if (id === selectedServiceId) return;
    persistEditor.flush();
    const svc = loadServices().find((s) => s.id === id);
    if (!svc) return;
    selectedServiceId = id;
    populateServiceEditor(els!, svc);
    renderList();
  }

  addBtn.addEventListener("command", () => {
    persistEditor.flush();
    const services = loadServices();
    const id = `svc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const selectedProvider = els.providerSelect.value as ProviderKey;
    const preset = getPreset(selectedProvider);
    const newSvc: ServiceProvider = {
      id,
      name: preset?.label || "New Service",
      provider: selectedProvider,
      apiFormat:
        preset?.apiFormat ||
        (els.apiFormatSelect.value as ApiFormat) ||
        "chat-completions",
      apiUrl: preset?.apiUrl || "",
      apiKey: "",
      model: preset?.defaultModel || "",
      miniModel: preset?.miniModel || "",
    };
    services.push(newSvc);
    saveServices(services);
    if (services.length === 1) setActiveServiceId(id);
    selectedServiceId = id;
    populateServiceEditor(els, newSvc);
    renderList();
    setSectionStatus(statusEl, "saved", getString("pref-svc-added"));
  });

  removeBtn.addEventListener("command", () => {
    if (!selectedServiceId) return;
    removeConfirm.dataset.serviceId = selectedServiceId;
    removeConfirm.style.display = "flex";
    removeConfirmCancel.focus();
  });

  const hideRemoveConfirm = () => {
    removeConfirm.style.display = "none";
    delete removeConfirm.dataset.serviceId;
  };
  removeConfirmCancel.addEventListener("command", hideRemoveConfirm);
  removeConfirm.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    event.preventDefault();
    hideRemoveConfirm();
  });
  removeConfirmAction.addEventListener("command", () => {
    const idToRemove = removeConfirm.dataset.serviceId;
    if (!idToRemove) return;
    if (idToRemove === selectedServiceId) persistEditor.cancel();
    let services = loadServices();
    services = services.filter((s) => s.id !== idToRemove);
    saveServices(services);
    if (getActiveServiceId() === idToRemove) {
      setActiveServiceId(services[0]?.id || "");
    }
    selectedServiceId = services[0]?.id || "";
    if (services[0]) populateServiceEditor(els, services[0]);
    else clearServiceEditor(els);
    hideRemoveConfirm();
    renderList();
    setSectionStatus(statusEl, "saved", getString("pref-svc-removed"));
  });

  defaultBtn.addEventListener("command", () => {
    if (!selectedServiceId) return;
    setActiveServiceId(selectedServiceId);
    renderList();
    setSectionStatus(statusEl, "saved", getString("pref-svc-defaultSet"));
  });

  testBtn.addEventListener("command", async () => {
    setSectionStatus(statusEl, "saving", getString("pref-testApi-running"));
    try {
      await AIService.testConnection(buildLiveServiceConfig(els));
      setSectionStatus(statusEl, "saved", getString("pref-testApi-success"));
    } catch (e: any) {
      setSectionStatus(
        statusEl,
        "error",
        `${getString("pref-testApi-fail")}: ${e?.message || String(e)}`,
      );
    }
  });

  const services = loadServices();
  selectedServiceId = getActiveServiceId() || services[0]?.id || "";
  const activeSvc = services.find((s) => s.id === selectedServiceId);
  if (activeSvc) populateServiceEditor(els, activeSvc);
  renderList();
}
