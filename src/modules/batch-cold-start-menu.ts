import { config } from "../../package.json";
import {
  coldStartQueue,
  type ColdStartJobInput,
} from "../services/cold-start-queue";
import { getZoteroPaperMeta } from "../services/zotero-paper-metadata";

const BUILD_MENU_ID = `${config.addonRef}-build-records`;
const CANCEL_MENU_ID = `${config.addonRef}-cancel-build-records`;

export function registerBatchColdStartMenu(win: Window) {
  const doc = win.document;
  const menu = doc.querySelector("#zotero-itemmenu");
  if (!menu || doc.getElementById(BUILD_MENU_ID)) return;

  const build = createMenuItem(doc, BUILD_MENU_ID, "Build Knowledge Records");
  build.addEventListener("command", () => {
    void enqueueSelectedPapers(win);
  });
  const cancel = createMenuItem(
    doc,
    CANCEL_MENU_ID,
    "Cancel Knowledge Record Queue",
  );
  cancel.addEventListener("command", () => {
    void coldStartQueue.cancel();
  });
  menu.appendChild(build);
  menu.appendChild(cancel);
  menu.addEventListener("popupshowing", () => {
    const selected = getSelectedItems(win);
    build.setAttribute(
      "label",
      selected.length > 1
        ? `Build Knowledge Records (${selected.length} selected)`
        : "Build Knowledge Records",
    );
    build.toggleAttribute("disabled", selected.length === 0);
    const hasActive = coldStartQueue
      .getState()
      .jobs.some((job) => job.status === "pending" || job.status === "running");
    cancel.toggleAttribute("disabled", !hasActive);
  });
}

export function unregisterBatchColdStartMenu(win: Window) {
  win.document.getElementById(BUILD_MENU_ID)?.remove();
  win.document.getElementById(CANCEL_MENU_ID)?.remove();
}

async function enqueueSelectedPapers(win: Window) {
  const inputs = buildColdStartInputs(getSelectedItems(win));
  if (!inputs.length) return;
  await coldStartQueue.enqueue(inputs);
  void coldStartQueue.start();
}

function buildColdStartInputs(items: any[]): ColdStartJobInput[] {
  const inputs: ColdStartJobInput[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const attachment = resolvePdfAttachment(item);
    const id = Number(attachment?.id);
    if (!attachment || id <= 0) continue;
    const paper = getZoteroPaperMeta(id);
    if (!paper.itemKey || seen.has(paper.itemKey)) continue;
    seen.add(paper.itemKey);
    inputs.push({ paper, pdfItemId: id });
  }
  return inputs;
}

function resolvePdfAttachment(item: any): any | null {
  if (isPdfAttachment(item)) return item;
  const attachmentIds = Array.isArray(item?.getAttachments?.())
    ? item.getAttachments()
    : [];
  for (const id of attachmentIds) {
    const attachment = Zotero.Items.get(id) as any;
    if (isPdfAttachment(attachment)) return attachment;
  }
  return null;
}

function isPdfAttachment(item: any): boolean {
  if (!item) return false;
  return Boolean(
    item.isPDFAttachment?.() ||
      item.attachmentContentType === "application/pdf" ||
      item.getField?.("mimeType") === "application/pdf",
  );
}

function getSelectedItems(win: Window): any[] {
  try {
    return ((win as any).ZoteroPane?.getSelectedItems?.() || []) as any[];
  } catch {
    return [];
  }
}

function createMenuItem(
  doc: Document,
  id: string,
  label: string,
): HTMLElement {
  const item = (doc as any).createXULElement
    ? (doc as any).createXULElement("menuitem")
    : doc.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        "menuitem",
      );
  item.id = id;
  item.setAttribute("label", label);
  return item as HTMLElement;
}
