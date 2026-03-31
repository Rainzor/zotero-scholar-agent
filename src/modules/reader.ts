import { config } from "../../package.json";

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
}
