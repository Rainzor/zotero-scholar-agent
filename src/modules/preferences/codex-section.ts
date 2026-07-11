import { getString } from "../../utils/locale";
import { debounce } from "../../utils/debounce";
import {
  getConfiguredCodexPath,
  getConfiguredCodexCheapModelSlug,
  getConfiguredCodexContextWindow,
  getConfiguredCodexModelSlug,
  getConfiguredColdStartReasoningEffort,
  detectCodexBinary,
  setConfiguredCodexCheapModelSlug,
  setConfiguredCodexContextWindow,
  setConfiguredCodexModelSlug,
  setConfiguredColdStartReasoningEffort,
  setConfiguredCodexPath,
  testCodexBinary,
} from "../../services/codex";
import { prefId } from "./ids";
import { setSectionStatus } from "./status";

const SAVE_DELAY_MS = 500;

export function bindCodexSettings(doc: Document): void {
  const pathInput = doc.querySelector(
    `#${prefId("codexPath")}`,
  ) as HTMLInputElement | null;
  const browseBtn = doc.querySelector(
    `#${prefId("codexBrowse")}`,
  ) as XUL.Button | null;
  const detectBtn = doc.querySelector(
    `#${prefId("codexDetect")}`,
  ) as XUL.Button | null;
  const testBtn = doc.querySelector(
    `#${prefId("codexTest")}`,
  ) as XUL.Button | null;
  const statusEl = doc.querySelector(
    `#${prefId("codexStatus")}`,
  ) as HTMLElement | null;
  const modelInput = doc.querySelector(
    `#${prefId("codexModelSlug")}`,
  ) as HTMLInputElement | null;
  const contextWindowInput = doc.querySelector(
    `#${prefId("codexContextWindow")}`,
  ) as HTMLInputElement | null;
  const cheapModelInput = doc.querySelector(
    `#${prefId("codexCheapModelSlug")}`,
  ) as HTMLInputElement | null;
  const coldStartEffortSelect = doc.querySelector(
    `#${prefId("codexColdStartEffort")}`,
  ) as HTMLSelectElement | null;
  if (
    !pathInput ||
    !browseBtn ||
    !detectBtn ||
    !testBtn ||
    !statusEl ||
    !modelInput ||
    !contextWindowInput ||
    !cheapModelInput ||
    !coldStartEffortSelect
  )
    return;

  pathInput.value = getConfiguredCodexPath();
  modelInput.value = getConfiguredCodexModelSlug();
  contextWindowInput.value =
    getConfiguredCodexContextWindow()?.toString() || "";
  cheapModelInput.value = getConfiguredCodexCheapModelSlug();
  coldStartEffortSelect.value = getConfiguredColdStartReasoningEffort() || "";
  setSectionStatus(
    statusEl,
    "idle",
    pathInput.value
      ? `${getString("pref-codex-configured")}: ${pathInput.value}`
      : getString("pref-codex-autoDetect"),
  );

  const persistPath = debounce((value: string) => {
    setConfiguredCodexPath(value);
    setSectionStatus(
      statusEl,
      "saved",
      value
        ? `${getString("pref-codex-saved")}: ${value}`
        : getString("pref-codex-autoDetect"),
    );
  }, SAVE_DELAY_MS);

  const commitPath = (value: string) => {
    setSectionStatus(statusEl, "saving", getString("pref-codex-saving"));
    persistPath(value.trim());
  };

  pathInput.addEventListener("input", () => commitPath(pathInput.value));

  const persistModel = debounce((value: string) => {
    setConfiguredCodexModelSlug(value);
    setSectionStatus(statusEl, "saved", getString("pref-codex-advancedSaved"));
  }, SAVE_DELAY_MS);
  modelInput.addEventListener("input", () => {
    setSectionStatus(statusEl, "saving", getString("pref-codex-saving"));
    persistModel(modelInput.value.trim());
  });

  const persistContextWindow = debounce((value: string) => {
    setConfiguredCodexContextWindow(value);
    setSectionStatus(statusEl, "saved", getString("pref-codex-advancedSaved"));
  }, SAVE_DELAY_MS);
  contextWindowInput.addEventListener("input", () => {
    setSectionStatus(statusEl, "saving", getString("pref-codex-saving"));
    persistContextWindow(contextWindowInput.value.trim());
  });

  const persistCheapModel = debounce((value: string) => {
    setConfiguredCodexCheapModelSlug(value);
    setSectionStatus(statusEl, "saved", getString("pref-codex-advancedSaved"));
  }, SAVE_DELAY_MS);
  cheapModelInput.addEventListener("input", () => {
    setSectionStatus(statusEl, "saving", getString("pref-codex-saving"));
    persistCheapModel(cheapModelInput.value.trim());
  });

  coldStartEffortSelect.addEventListener("change", () => {
    setConfiguredColdStartReasoningEffort(coldStartEffortSelect.value);
    setSectionStatus(statusEl, "saved", getString("pref-codex-advancedSaved"));
  });

  browseBtn.addEventListener("command", async () => {
    const picker = new ztoolkit.FilePicker(
      getString("pref-codex-browseTitle"),
      "open",
      undefined,
      undefined,
      undefined,
      undefined,
      pathInput.value.trim() || undefined,
    );
    const selected = await picker.open();
    if (!selected) return;
    pathInput.value = selected;
    commitPath(selected);
  });

  detectBtn.addEventListener("command", async () => {
    setSectionStatus(statusEl, "saving", getString("pref-codex-detecting"));
    const result = await detectCodexBinary();
    if (result.ok) {
      pathInput.value = result.path;
      commitPath(result.path);
      return;
    }
    setSectionStatus(
      statusEl,
      "error",
      `${getString("pref-codex-fail")}: ${result.error || "Unknown error"}`,
    );
  });

  testBtn.addEventListener("command", async () => {
    const explicitPath = pathInput.value.trim();
    setSectionStatus(statusEl, "saving", getString("pref-codex-testing"));
    const result = await testCodexBinary(explicitPath || undefined);
    if (result.ok) {
      setSectionStatus(
        statusEl,
        "saved",
        [
          `${getString("pref-codex-success")}: ${result.version}`,
          `Path: ${result.path}`,
          result.source ? `Source: ${result.source}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      return;
    }
    setSectionStatus(
      statusEl,
      "error",
      `${getString("pref-codex-fail")}: ${result.error || "Unknown error"}`,
    );
  });
}
