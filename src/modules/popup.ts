import { config } from "../../package.json";
import { AIService } from "../services/ai-service";
import { translatePrompt } from "../services/prompts";
import { getPreset } from "../utils/provider-presets";
import { getActiveService } from "../utils/services";
const DEFAULT_TRANSLATE_TARGET_LANG = "zh-CN";

export function buildReaderPopup(
  event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
) {
  const { reader, doc, append } = event;
  const popup = doc.querySelector(".selection-popup") as HTMLDivElement;
  if (!popup) return;

  Array.from(
    popup.querySelectorAll(
      `.${config.addonRef}-readerpopup-actions, .${config.addonRef}-readerpopup-result`,
    ),
  ).forEach((node) => (node as Element).remove());

  addon.data.popup.currentPopup = popup;
  popup.style.maxWidth = "none";
  popup.setAttribute(
    `${config.addonRef}-prefix`,
    `${config.addonRef}-${reader._instanceID}`,
  );

  const makeId = (type: string) =>
    `${config.addonRef}-${reader._instanceID}-${type}`;

  append(
    ztoolkit.UI.createElement(doc, "fragment", {
      children: [
        {
          tag: "div",
          id: makeId("actions"),
          classList: [`${config.addonRef}-readerpopup-actions`],
          styles: {
            display: "flex",
            gap: "6px",
            width: "calc(100% - 4px)",
            margin: "2px",
          },
          children: [
            {
              tag: "button",
              namespace: "html",
              id: makeId("translate"),
              classList: ["toolbar-button", "wide-button"],
              properties: {
                innerText: "Translate",
                onclick: () => {
                  const btn = popup.querySelector(`#${makeId("translate")}`) as HTMLElement;
                  if (btn) btn.hidden = true;
                  const ta = popup.querySelector(`#${makeId("result")}`) as HTMLElement;
                  if (ta) ta.hidden = false;
                  void runTranslate(popup, makeId);
                },
              },
              ignoreIfExists: true,
            },
            {
              tag: "button",
              namespace: "html",
              id: makeId("ask"),
              classList: ["toolbar-button", "wide-button"],
              properties: {
                innerText: "Ask",
                onclick: () => {
                  const text = addon.data.popup.selectedText;
                  const pageLabel = addon.data.popup.selectedPageLabel;
                  if (text) {
                    addon.api.setReferenceText(text, pageLabel);
                  }
                },
              },
              ignoreIfExists: true,
            },
          ],
        },
        {
          tag: "textarea",
          id: makeId("result"),
          classList: [`${config.addonRef}-readerpopup-result`],
          attributes: { rows: "3" },
          styles: {
            width: "-moz-available",
            height: "30px",
            marginInline: "2px",
            border: "none",
            background: "var(--color-sidepane)",
            borderRadius: "6px",
            padding: "6px",
            fontSize: "12px",
            lineHeight: "1.5",
            fontFamily: "inherit",
          },
          properties: {
            hidden: true,
            spellcheck: false,
            onpointerup: (e: Event) => e.stopPropagation(),
            ondragstart: (e: Event) => e.stopPropagation(),
          },
          ignoreIfExists: true,
        },
      ],
    }),
  );
}

export function updateReaderPopup() {
  // Textarea is hidden by default; nothing to update on initial render.
}

async function runTranslate(
  popup: HTMLDivElement,
  makeId: (type: string) => string,
) {
  const selectedText = addon.data.popup.selectedText;
  if (!selectedText) return;

  const textarea = popup.querySelector(
    `#${makeId("result")}`,
  ) as HTMLTextAreaElement | null;
  if (!textarea) return;

  textarea.value = "Translating...";

  try {
    const targetLanguage = DEFAULT_TRANSLATE_TARGET_LANG;
    const messages = translatePrompt(selectedText, targetLanguage);
    const svc = getActiveService();
    const miniModel = svc?.miniModel || getPreset(svc?.provider || "custom")?.miniModel;
    await AIService.chat(messages as any, {
      stream: true,
      disableThinking: true,
      model: miniModel,
      onChunk: (state) => {
        if (!popup.isConnected) return;
        textarea.value = state.content;
        resizePopup(popup, textarea);
      },
    });
    resizePopup(popup, textarea);
  } catch (e: any) {
    textarea.value = `[Error] ${e?.message || String(e)}`;
    resizePopup(popup, textarea);
  }
}

function resizePopup(
  popup: HTMLDivElement,
  textarea: HTMLTextAreaElement,
  resetSize = true,
) {
  try {
    if (resetSize) {
      textarea.style.width = "-moz-available";
      textarea.style.height = "30px";
    }
    const viewer = popup.ownerDocument.body;
    const textHeight = textarea.scrollHeight;
    const textWidth = textarea.scrollWidth;
    const newWidth = textWidth + 20;
    if (
      textHeight / textWidth > 0.75 &&
      popup.offsetLeft + newWidth < viewer.offsetWidth
    ) {
      textarea.style.width = `${newWidth}px`;
      resizePopup(popup, textarea, false);
      return;
    }
    textarea.style.height = `${textHeight + 3}px`;
  } catch (_e) {
    // Ignore resize errors.
  }
}
