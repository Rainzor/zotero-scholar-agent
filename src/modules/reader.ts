import { config } from "../../package.json";
import { updateSidebarPanels } from "./sidebar";

export function registerReaderInitializer() {
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    (event) => {
      const selectedText = event.params?.annotation?.text?.trim?.() || "";
      const selectedPageLabel = getSelectionPageLabel(event.params?.annotation);
      addon.data.popup.selectedText = selectedText;
      addon.data.popup.selectedPageLabel = selectedPageLabel;
      addon.data.popup.currentReader = event.reader;
      addon.hooks.onReaderPopupShow(event);
    },
    config.addonID,
  );

  Zotero.Reader.registerEventListener(
    "renderToolbar",
    (_event) => {
      if (typeof addon !== "undefined" && !addon.data.alive) return;
      updateSidebarPanels();
    },
    config.addonID,
  );
}

function getSelectionPageLabel(annotation: any): string {
  const pageLabel = String(annotation?.pageLabel || "").trim();
  if (pageLabel) return pageLabel;
  const pageIndex = Number(annotation?.position?.pageIndex);
  if (Number.isFinite(pageIndex) && pageIndex >= 0) {
    return String(pageIndex + 1);
  }
  return "";
}
