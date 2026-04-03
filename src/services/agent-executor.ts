import { AIService } from "./ai-service";
import {
  askPrompt,
  contextPlanningPrompt,
  initPaperPrompt,
  type RetrievedPage,
} from "./prompts";
import { buildContextMessages, truncateDocContext } from "./context-builder";
import { getFullText, getMultiPageText, getCurrentPageNumber } from "../modules/pdf-context";
import { loadPaperOverview, savePaperOverview } from "./paper-overview";
import {
  formatStructuredPagesForPrompt,
  getPdfDocumentFromReader,
  parseAllPages,
  stripReferencesFromPages,
  type StructuredPage,
} from "./pdf-parser";
import { buildPageCacheData, loadPageCache, savePageCache } from "./page-cache";

type PromptMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type StreamState = {
  content: string;
  reasoning: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
};

type AgentStatusStage = "init" | "plan" | "load" | "answer";

export type AgentExecutionInput = {
  itemId: number;
  itemKey: string;
  pdfItemId: number;
  question: string;
  reader?: _ZoteroTypes.ReaderInstance | null;
  history: PromptMessage[];
  maxContextTokens: number;
  paperOverview?: string;
  miniModel?: string;
  pendingImages?: string[];
  historySummary?: string;
  onStatus?: (stage: AgentStatusStage, text: string) => void;
  onRequest?: (xhr: XMLHttpRequest) => void;
  onChunk?: (state: StreamState) => void;
};

type ContextPlan = {
  pages: number[];
  reasoning: string;
};

export async function ensureAgentsMd(
  itemKey: string,
  pdfItemId: number,
  maxContextTokens: number,
  onStatus?: AgentExecutionInput["onStatus"],
  reader?: _ZoteroTypes.ReaderInstance | null,
): Promise<string> {
  const existing = await loadPaperOverview(itemKey);
  if (existing?.trim()) return existing;

  onStatus?.("init", "Generating AGENTS.md...");
  const cachedPages = await ensurePageCache(itemKey, reader, onStatus);
  const llmPages = stripReferencesFromPages(cachedPages);
  const structuredText = formatStructuredPagesForPrompt(llmPages);
  const fullText = structuredText || (await getFullText(pdfItemId));
  if (!fullText.trim()) {
    throw new Error(
      "PDF attachment found, but full text could not be extracted. Please verify the PDF has a text layer or has been indexed.",
    );
  }
  const clipped = truncateDocContext(fullText, Math.floor(maxContextTokens * 0.8));
  const prompts = initPaperPrompt(clipped);
  const result = await AIService.chat(prompts as any, {
    stream: false,
    disableThinking: true,
    timeoutMs: 300000,
  });
  const overview = String(result.content || "").trim();
  if (!overview) {
    throw new Error("Failed to generate AGENTS.md: the model did not return valid content.");
  }
  await savePaperOverview(itemKey, overview);
  return overview;
}

export async function planContext(options: {
  question: string;
  paperOverview: string;
  currentPageNumber?: number;
  historySummary?: string;
  miniModel?: string;
}): Promise<ContextPlan> {
  const prompts = contextPlanningPrompt(
    options.question,
    options.paperOverview,
    options.currentPageNumber,
    options.historySummary,
  );
  const result = await AIService.chat(prompts as any, {
    stream: false,
    disableThinking: true,
    model: options.miniModel,
    maxTokens: 300,
    timeoutMs: 20000,
  });
  return parseContextPlan(result.content || "", options.currentPageNumber);
}

export async function executeAgent(options: AgentExecutionInput): Promise<{
  answer: StreamState;
  usedPages: RetrievedPage[];
  plan: ContextPlan;
}> {
  const onStatus = options.onStatus;
  const reader = options.reader || null;
  const currentPageNumber = await getCurrentPageNumber(reader);
  const cachedPages = await ensurePageCache(options.itemKey, reader, onStatus);
  const llmPages = stripReferencesFromPages(cachedPages);
  const cacheByPage = indexByPage(llmPages);

  const paperOverview =
    (options.paperOverview || "").trim() ||
    (await ensureAgentsMd(
      options.itemKey,
      options.pdfItemId,
      options.maxContextTokens,
      onStatus,
      reader,
    ));

  onStatus?.("plan", "Planning relevant pages...");
  let plan: ContextPlan;
  try {
    plan = await planContext({
      question: options.question,
      paperOverview,
      currentPageNumber,
      historySummary: options.historySummary,
      miniModel: options.miniModel,
    });
  } catch (_e) {
    const fallbackPage = currentPageNumber > 0 ? [currentPageNumber] : [];
    plan = { pages: fallbackPage, reasoning: "Planning failed; fallback to current page." };
  }

  const pagesToLoad = selectPages(plan.pages, currentPageNumber);
  onStatus?.("load", pagesToLoad.length ? `Loading pages ${pagesToLoad.join(", ")}...` : "Loading context...");
  const missingPages = pagesToLoad.filter((page) => !cacheByPage.has(page));
  const pageMap = missingPages.length ? await getMultiPageText(reader, missingPages) : new Map<number, string>();
  const retrievedPages = pagesToLoad
    .map((pageNumber) => ({
      pageNumber,
      text: String(cacheByPage.get(pageNumber) || pageMap.get(pageNumber) || "").trim(),
    }))
    .filter((p) => p.text);

  const prompts = askPrompt(options.question, retrievedPages, paperOverview);
  if ((options.pendingImages || []).length > 0) {
    prompts[0].content +=
      "\nThe user has attached images. Analyze image content together with the paper context and the user question.";
  }

  const messages = buildContextMessages({
    systemMessage: prompts[0] as any,
    currentMessage: prompts[1] as any,
    history: options.history as any,
    maxContextTokens: options.maxContextTokens,
  }) as any[];
  if ((options.pendingImages || []).length > 0 && messages.length > 0) {
    const lastIndex = messages.length - 1;
    messages[lastIndex] = {
      ...messages[lastIndex],
      content: AIService.buildMultimodalUserContent(
        String(messages[lastIndex]?.content || ""),
        options.pendingImages || [],
      ),
    };
  }

  onStatus?.("answer", "Generating answer...");
  const answer = await AIService.chat(messages as any, {
    stream: true,
    onRequest: options.onRequest,
    onChunk: options.onChunk,
  });

  return { answer, usedPages: retrievedPages, plan };
}

export async function ensurePageCache(
  itemKey: string,
  reader?: _ZoteroTypes.ReaderInstance | null,
  onStatus?: AgentExecutionInput["onStatus"],
): Promise<StructuredPage[]> {
  const existing = await loadPageCache(itemKey);
  if (existing?.pages?.length) return existing.pages;

  const pdfDocument = getPdfDocumentFromReader(reader);
  if (!pdfDocument) return [];

  onStatus?.("init", "Pre-processing PDF pages...");
  const pages = await parseAllPages(pdfDocument);
  if (!pages.length) return [];
  await savePageCache(itemKey, buildPageCacheData(pages));
  return pages;
}

function parseContextPlan(raw: string, currentPageNumber?: number): ContextPlan {
  const text = String(raw || "").trim();
  const fallbackPage = currentPageNumber && currentPageNumber > 0 ? [currentPageNumber] : [];
  if (!text) return { pages: fallbackPage, reasoning: "No planning output." };

  let payload: any = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = extractJsonObject(text);
  }
  if (!payload || typeof payload !== "object") {
    return { pages: fallbackPage, reasoning: "Invalid planning output." };
  }

  const pages = selectPages(Array.isArray(payload.pages) ? payload.pages : [], currentPageNumber);
  const reasoning = String(payload.reasoning || "").trim();
  return {
    pages,
    reasoning: reasoning || "Planned pages from AGENTS.md index.",
  };
}

function extractJsonObject(raw: string): any {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function selectPages(candidates: any[], fallbackPageNumber?: number): number[] {
  const numbers = Array.from(
    new Set(
      (candidates || [])
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0)
        .map((v) => Math.floor(v)),
    ),
  ).sort((a, b) => a - b);
  if (numbers.length > 0) return numbers.slice(0, 5);
  if (fallbackPageNumber && fallbackPageNumber > 0) return [Math.floor(fallbackPageNumber)];
  return [];
}

function indexByPage(pages: StructuredPage[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const page of pages || []) {
    const n = Math.max(1, Math.floor(Number(page.pageNumber) || 0));
    const text = String(page.plainText || "").trim();
    if (n > 0) map.set(n, text);
  }
  return map;
}
