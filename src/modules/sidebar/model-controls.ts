import { chatStore } from "../../services/chat-store";
import {
  listCodexModels,
  type CodexModelCatalogEntry,
  type CodexReasoningEffort,
} from "../../services/codex";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
let requestSequence = 0;

export type ModelControlOptions = {
  isGenerating: () => boolean;
  isSafeBody: (body: HTMLElement) => boolean;
};

export async function syncModelControls(
  body: HTMLElement,
  itemId: number,
  options: ModelControlOptions,
  refresh = false,
): Promise<void> {
  const select = body.querySelector(
    "#zoteroagent-model-select",
  ) as HTMLSelectElement | null;
  const reasoningSelect = body.querySelector(
    "#zoteroagent-reasoning-select",
  ) as HTMLSelectElement | null;
  const session = chatStore.getSession(itemId);
  if (!select || !reasoningSelect) return;
  const sessionId = session?.sessionId || "";

  const requestId = String(++requestSequence);
  select.dataset.requestId = requestId;
  select.disabled = true;
  reasoningSelect.disabled = true;
  let models: CodexModelCatalogEntry[] = [];
  try {
    models = await listCodexModels({ refresh });
  } catch (error) {
    ztoolkit.log("[Agent] Codex model catalog error:", error);
  }
  if (
    !options.isSafeBody(body) ||
    Number(body.dataset.itemID) !== itemId ||
    select.dataset.requestId !== requestId
  ) {
    return;
  }
  const activeSession = chatStore.getSession(itemId);
  if ((activeSession?.sessionId || "") !== sessionId) return;

  renderModelOptions(select, models, activeSession?.modelSlug || "");
  const supportedEfforts = getSupportedReasoningEfforts(
    models,
    activeSession?.modelSlug || "",
  );
  const selectedEffort = activeSession?.reasoningEffort;
  const canValidateEffort =
    models.length > 0 &&
    (!activeSession?.modelSlug ||
      models.some((model) => model.slug === activeSession.modelSlug));
  const normalizedEffort =
    selectedEffort &&
    (!canValidateEffort || supportedEfforts.includes(selectedEffort))
      ? selectedEffort
      : undefined;
  if (
    selectedEffort &&
    canValidateEffort &&
    !normalizedEffort &&
    activeSession
  ) {
    chatStore.updateSessionReasoningEffort(
      itemId,
      undefined,
      activeSession.sessionId,
    );
  }
  renderReasoningOptions(
    reasoningSelect,
    !canValidateEffort && selectedEffort ? [selectedEffort] : supportedEfforts,
    normalizedEffort,
  );
  select.disabled = options.isGenerating();
  reasoningSelect.disabled = options.isGenerating();
}

export function updateModelSelectorTitle(
  select: HTMLSelectElement,
  modelSlug: string,
): void {
  select.title = modelSlug
    ? `Model for this chat: ${modelSlug}`
    : "Model for this chat: Codex default";
}

function getSupportedReasoningEfforts(
  models: CodexModelCatalogEntry[],
  modelSlug: string,
): CodexReasoningEffort[] {
  const selected = modelSlug
    ? models.find((model) => model.slug === modelSlug)
    : undefined;
  const efforts = selected
    ? selected.supportedReasoningEfforts || []
    : models.flatMap((model) => model.supportedReasoningEfforts || []);
  return Array.from(new Set(efforts.map((entry) => entry.effort)));
}

function renderReasoningOptions(
  select: HTMLSelectElement,
  efforts: CodexReasoningEffort[],
  selected?: CodexReasoningEffort,
): void {
  while (select.firstChild) select.firstChild.remove();
  const defaultOption = select.ownerDocument.createElementNS(
    XHTML_NS,
    "option",
  ) as HTMLOptionElement;
  defaultOption.value = "";
  defaultOption.textContent = "Thinking default";
  select.appendChild(defaultOption);
  const labels: Record<CodexReasoningEffort, string> = {
    none: "None",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "XHigh",
  };
  for (const effort of efforts) {
    const option = select.ownerDocument.createElementNS(
      XHTML_NS,
      "option",
    ) as HTMLOptionElement;
    option.value = effort;
    option.textContent = labels[effort];
    select.appendChild(option);
  }
  select.value = selected || "";
  select.title = selected
    ? `Thinking intensity: ${labels[selected]}`
    : "Thinking intensity: Codex default";
}

function renderModelOptions(
  select: HTMLSelectElement,
  models: CodexModelCatalogEntry[],
  selectedModel: string,
): void {
  while (select.firstChild) select.firstChild.remove();
  const doc = select.ownerDocument;
  const defaultOption = doc.createElementNS(
    XHTML_NS,
    "option",
  ) as HTMLOptionElement;
  defaultOption.value = "";
  defaultOption.textContent = "Codex default";
  select.appendChild(defaultOption);

  for (const model of models) {
    const option = doc.createElementNS(XHTML_NS, "option") as HTMLOptionElement;
    option.value = model.slug;
    option.textContent = model.displayName || model.slug;
    option.title = model.slug;
    select.appendChild(option);
  }

  const normalized = String(selectedModel || "").trim();
  if (normalized && !models.some((model) => model.slug === normalized)) {
    const unavailable = doc.createElementNS(
      XHTML_NS,
      "option",
    ) as HTMLOptionElement;
    unavailable.value = normalized;
    unavailable.textContent = `${normalized} (unavailable)`;
    select.appendChild(unavailable);
  }
  select.value = normalized;
  updateModelSelectorTitle(select, normalized);
}
