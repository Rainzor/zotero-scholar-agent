import { getString } from "../../utils/locale";
import { debounce } from "../../utils/debounce";
import {
  getConfiguredVaultPath,
  getDefaultVaultPath,
  setConfiguredVaultPath,
} from "../../services/codex";
import { prefId } from "./ids";
import { setSectionStatus } from "./status";

const SAVE_DELAY_MS = 500;

export function bindVaultSettings(doc: Document): void {
  const pathInput = doc.querySelector(
    `#${prefId("vaultPath")}`,
  ) as HTMLInputElement | null;
  const browseBtn = doc.querySelector(
    `#${prefId("vaultBrowse")}`,
  ) as XUL.Button | null;
  const defaultBtn = doc.querySelector(
    `#${prefId("vaultDefault")}`,
  ) as XUL.Button | null;
  const statusEl = doc.querySelector(
    `#${prefId("vaultStatus")}`,
  ) as HTMLElement | null;
  if (!pathInput || !browseBtn || !defaultBtn || !statusEl) return;

  const configured = getConfiguredVaultPath();
  pathInput.value = configured || getDefaultVaultPath();
  setSectionStatus(
    statusEl,
    "idle",
    configured
      ? `${getString("pref-vault-configured")}: ${configured}`
      : `${getString("pref-vault-default")}\n${getDefaultVaultPath()}`,
  );

  const persist = debounce((value: string) => {
    setConfiguredVaultPath(value);
    setSectionStatus(
      statusEl,
      "saved",
      `${getString("pref-vault-saved")}\n${value || getDefaultVaultPath()}`,
    );
  }, SAVE_DELAY_MS);

  const commit = (value: string) => {
    setSectionStatus(statusEl, "saving", getString("pref-vault-saving"));
    persist(value.trim());
  };

  pathInput.addEventListener("input", () => commit(pathInput.value));

  browseBtn.addEventListener("command", async () => {
    const picker = new ztoolkit.FilePicker(
      getString("pref-vault-browseTitle"),
      "folder",
      undefined,
      undefined,
      undefined,
      undefined,
      pathInput.value.trim() || undefined,
    );
    const selected = await picker.open();
    if (!selected) return;
    pathInput.value = selected;
    commit(selected);
  });

  defaultBtn.addEventListener("command", () => {
    persist.cancel();
    setConfiguredVaultPath("");
    pathInput.value = getDefaultVaultPath();
    setSectionStatus(
      statusEl,
      "saved",
      `${getString("pref-vault-default")}\n${getDefaultVaultPath()}`,
    );
  });
}
