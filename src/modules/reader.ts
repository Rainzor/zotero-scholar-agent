import { config } from "../../package.json";
import { updateSidebarPanels } from "./sidebar";

export function registerReaderInitializer() {
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    (event) => {
      const selectedText = event.params?.annotation?.text?.trim?.() || "";
      addon.data.popup.selectedText = selectedText;
      addon.data.popup.currentReader = event.reader;
      addon.hooks.onReaderPopupShow(event);
    },
    config.addonID,
  );

  Zotero.Reader.registerEventListener(
    "renderToolbar",
    (_event) => {
      updateSidebarPanels();
    },
    config.addonID,
  );
}
