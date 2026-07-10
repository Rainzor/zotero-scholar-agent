import type {
  ChatMessage,
  CodexActivity,
  PaperContext,
  TokenUsage,
} from "../../addon";
import {
  appendConversationTurn,
  appendVaultLog,
  CodexTurnError,
  commitVaultChanges,
  ensurePaperVault,
  readPaperCompactContext,
  readPaperMemory,
  refreshPaperRecordProjection,
  runCodexTurn,
  type CodexEvent,
  type CodexTurnInput,
  type CodexTurnResult,
  type EnsurePaperVaultOptions,
  type PaperVaultMeta,
  type RunningLineProcess,
  type SemanticRelationship,
} from "../codex";
import { collectCodexActivity } from "./activity";
import {
  buildCodexResearchPrompt,
  getRecentMessagesForPrompt,
  type PromptPaperContext,
  type ResearchPromptMode,
} from "./prompt";
import { diffRelationships } from "./relationships";

export type ResearchTurnRequest = {
  paper: PaperVaultMeta;
  pdfItemId: number;
  reader?: _ZoteroTypes.ReaderInstance | null;
  question: string;
  mentionedPapers: PaperContext[];
  session: {
    sessionId: string;
    codexThreadId?: string;
    contextDigest?: string;
    contextDigestUpToMessageIndex?: number;
  };
  priorVisibleMessages: ChatMessage[];
  userDisplayContent: string;
};

export type ResearchTurnEvents = {
  onStatus?: (text: string) => void;
  onChunk?: (state: {
    content: string;
    reasoning: string;
    usage?: TokenUsage;
  }) => void;
  onActivities?: (activities: CodexActivity[]) => void;
  onProcess?: (proc: RunningLineProcess) => void;
};

export type ResearchTurnOutcome = {
  content: string;
  reasoning: string;
  threadId: string;
  usage?: TokenUsage;
  activities: CodexActivity[];
  memoryUpdated: boolean;
  relationshipUpdates: SemanticRelationship[];
  committed: boolean;
  resumedFreshThread: boolean;
};

export type ResearchTurnDeps = {
  ensurePaperVault: typeof ensurePaperVault;
  readPaperMemory: typeof readPaperMemory;
  refreshPaperRecordProjection: typeof refreshPaperRecordProjection;
  readPaperCompactContext: typeof readPaperCompactContext;
  runCodexTurn: typeof runCodexTurn;
  appendConversationTurn: typeof appendConversationTurn;
  commitVaultChanges: typeof commitVaultChanges;
  appendVaultLog: typeof appendVaultLog;
};

const defaultDeps: ResearchTurnDeps = {
  ensurePaperVault,
  readPaperMemory,
  refreshPaperRecordProjection,
  readPaperCompactContext,
  runCodexTurn,
  appendConversationTurn,
  commitVaultChanges,
  appendVaultLog,
};

export async function runResearchTurn(
  request: ResearchTurnRequest,
  events: ResearchTurnEvents = {},
  depsOverride: Partial<ResearchTurnDeps> = {},
): Promise<ResearchTurnOutcome> {
  const deps = { ...defaultDeps, ...depsOverride };
  try {
    return await runResearchTurnInner(request, events, deps);
  } catch (error) {
    await deps.appendVaultLog("chat-turn-error", errorMessage(error), {
      itemId: request.paper.itemId,
      itemKey: request.paper.itemKey,
      title: request.paper.title,
      sessionId: request.session.sessionId,
      codexThreadId: request.session.codexThreadId,
    });
    throw error;
  }
}

async function runResearchTurnInner(
  request: ResearchTurnRequest,
  events: ResearchTurnEvents,
  deps: ResearchTurnDeps,
): Promise<ResearchTurnOutcome> {
  const paper = request.paper;
  await deps.ensurePaperVault({
    ...paper,
    pdfItemId: request.pdfItemId,
    reader: request.reader,
    onStatus: events.onStatus,
  } satisfies EnsurePaperVaultOptions);

  const memoryBefore = await deps.readPaperMemory(paper.itemKey);
  const relationshipsBefore = await deps.refreshPaperRecordProjection(paper);
  const mentionedContexts = await buildMentionedPaperContexts(
    request.mentionedPapers,
    deps,
  );
  const recentMessages = getRecentMessagesForPrompt(
    request.session,
    request.priorVisibleMessages,
  );
  const activities: CodexActivity[] = [];
  const activityById = new Map<string, CodexActivity>();
  const onEvent = (event: CodexEvent) => {
    if (collectCodexActivity(activities, activityById, event)) {
      events.onActivities?.(activities.slice());
    }
  };

  const initialThreadId = String(request.session.codexThreadId || "").trim();
  let resumedFreshThread = false;
  let result: CodexTurnResult;
  try {
    result = await runCodexAttempt({
      request,
      mentionedContexts,
      recentMessages,
      threadId: initialThreadId,
      mode: initialThreadId ? "resume" : "fresh-thread",
      onEvent,
      events,
      deps,
    });
  } catch (error) {
    if (!shouldRetryAsFreshThread(error, initialThreadId)) throw error;
    resumedFreshThread = true;
    events.onStatus?.("Codex resume failed. Retrying in a fresh thread...");
    await deps.appendVaultLog(
      "codex-resume-fallback",
      "Codex resume failed; retrying in a fresh thread with hidden context.",
      {
        itemKey: paper.itemKey,
        sessionId: request.session.sessionId,
        codexThreadId: initialThreadId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    result = await runCodexAttempt({
      request,
      mentionedContexts,
      recentMessages,
      threadId: "",
      mode: "fresh-thread",
      onEvent,
      events,
      deps,
    });
  }

  await deps.appendConversationTurn({
    itemKey: paper.itemKey,
    sessionId: request.session.sessionId,
    userMessage: request.userDisplayContent,
    assistantMessage: result.content,
    codexThreadId: result.threadId,
  });
  const memoryAfter = await deps.readPaperMemory(paper.itemKey);
  const relationshipsAfter = await deps.refreshPaperRecordProjection(paper);
  const committed = await deps.commitVaultChanges(
    `turn: ${paper.itemKey} ${request.session.sessionId}`.trim(),
  );

  return {
    content: result.content,
    reasoning: result.reasoning,
    threadId: result.threadId,
    usage: result.usage,
    activities,
    memoryUpdated: memoryAfter.trim() !== memoryBefore.trim(),
    relationshipUpdates: diffRelationships(
      relationshipsBefore,
      relationshipsAfter,
    ),
    committed,
    resumedFreshThread,
  };
}

async function runCodexAttempt(options: {
  request: ResearchTurnRequest;
  mentionedContexts: PromptPaperContext[];
  recentMessages: ChatMessage[];
  threadId: string;
  mode: ResearchPromptMode;
  onEvent: (event: CodexEvent) => void;
  events: ResearchTurnEvents;
  deps: ResearchTurnDeps;
}): Promise<CodexTurnResult> {
  const { request, mentionedContexts, recentMessages, threadId, mode, events, deps } =
    options;
  const prompt = buildCodexResearchPrompt({
    itemKey: request.paper.itemKey,
    title: request.paper.title,
    creators: request.paper.creators || "",
    year: request.paper.year || "",
    question: request.question,
    mode,
    mentionedPapers: mentionedContexts,
    contextDigest: request.session.contextDigest,
    recentMessages,
  });
  return deps.runCodexTurn({
    prompt,
    threadId,
    sandbox: "workspace-write",
    onStatus: events.onStatus,
    onProcess: events.onProcess,
    onEvent: options.onEvent,
    onChunk: events.onChunk as CodexTurnInput["onChunk"],
  });
}

async function buildMentionedPaperContexts(
  papers: PaperContext[],
  deps: Pick<ResearchTurnDeps, "readPaperCompactContext">,
): Promise<PromptPaperContext[]> {
  const contexts: PromptPaperContext[] = [];
  for (const paper of papers || []) {
    contexts.push({
      ...paper,
      memory: await deps.readPaperCompactContext({
        itemId: 0,
        itemKey: paper.itemKey,
        title: paper.title,
        creators: paper.creators,
        year: paper.year,
      }),
    });
  }
  return contexts;
}

function shouldRetryAsFreshThread(error: unknown, threadId: string): boolean {
  if (!threadId) return false;
  // Only a Codex process failure suggests a stale/lost thread. Errors thrown
  // before or outside the Codex run (binary/vault resolution, callback bugs)
  // would fail identically on a fresh thread, so don't pay for a second run.
  return error instanceof CodexTurnError && !error.timedOut;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
