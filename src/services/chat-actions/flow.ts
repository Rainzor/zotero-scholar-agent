import type { ChatMessage, ChatSession, PaperContext } from "../../addon";
import type { LocalImageRef } from "../local-images";
import type { PaperVaultMeta, RunningLineProcess } from "../codex";
import {
  appendConversationTurn,
  appendPaperNote,
  assertVaultPathsClean,
  captureVaultTextFiles,
  commitVaultPaths,
  restoreVaultTextFiles,
} from "../codex";
import { safePathSegment } from "../codex/vault-format";
import { organizePaperNote } from "./note";
import { parseChatIntent } from "./intent";
import { transitionAgentAction, type AgentActionCard } from "./types";

export type ChatSubmission = {
  itemId: number;
  paper: PaperVaultMeta;
  pdfItemId: number;
  session: Pick<
    ChatSession,
    | "sessionId"
    | "codexThreadId"
    | "modelSlug"
    | "reasoningEffort"
    | "contextDigest"
    | "contextDigestUpToMessageIndex"
  >;
  text: string;
  selectedText: string;
  responseQuote: string;
  mentionedPapers: PaperContext[];
  imageRefs: LocalImageRef[];
  imagePaths: string[];
  priorVisibleMessages: ChatMessage[];
  displayContent: string;
  conversationDisplayContent: string;
};

export type ActionDecision = "confirm" | "dismiss" | "retry";

export type ChatFlowSink = {
  onChanged?: (itemId: number) => void;
  onRunning?: (running: boolean) => void;
  onStatus?: (text: string) => void;
  onProcess?: (process: RunningLineProcess | null) => void;
};

export interface ChatSendFlow {
  canSubmit(): boolean;
  submit(request: ChatSubmission, sink: ChatFlowSink): Promise<void>;
  decide(
    actionId: string,
    decision: ActionDecision,
    sink: ChatFlowSink,
  ): Promise<void>;
  cancel(itemId: number, sessionId: string): void;
  isActive(itemId: number, sessionId: string): boolean;
}

export type ChatFlowStore = {
  addMessage(itemId: number, message: ChatMessage, sessionId?: string): void;
  updateAction(
    itemId: number,
    actionId: string,
    update: (action: AgentActionCard) => AgentActionCard,
  ): boolean;
  findAction(actionId: string): {
    itemId: number;
    itemKey: string;
    sessionId: string;
    message: ChatMessage;
    action: AgentActionCard;
  } | null;
  touchSession(itemId: number): void;
};

type FlowDeps = {
  store: ChatFlowStore;
  runResearch: (request: ChatSubmission, sink: ChatFlowSink) => Promise<void>;
  organizeNote: typeof organizePaperNote;
  appendConversationTurn: typeof appendConversationTurn;
  appendPaperNote?: typeof appendPaperNote;
  assertVaultPathsClean?: typeof assertVaultPathsClean;
  captureVaultTextFiles?: typeof captureVaultTextFiles;
  restoreVaultTextFiles?: typeof restoreVaultTextFiles;
  commitVaultPaths?: typeof commitVaultPaths;
  now?: () => number;
  newActionId?: () => string;
};

type ActiveActionExecution = {
  actionId: string;
  executionId: number;
  itemId: number;
  process: RunningLineProcess | null;
  cancellable: boolean;
};

const activeActionsBySession = new Map<string, ActiveActionExecution>();
let activeResearch:
  | {
      itemId: number;
      sessionId: string;
      process: RunningLineProcess | null;
      cancelled: boolean;
    }
  | undefined;
let activeLocalTurns = 0;
let nextExecutionId = 0;

export class DefaultChatSendFlow implements ChatSendFlow {
  private readonly deps: FlowDeps;

  constructor(deps: FlowDeps) {
    this.deps = deps;
  }

  canSubmit(): boolean {
    return (
      activeActionsBySession.size === 0 &&
      !activeResearch &&
      activeLocalTurns === 0
    );
  }

  async submit(request: ChatSubmission, sink: ChatFlowSink): Promise<void> {
    if (!this.canSubmit()) {
      sink.onStatus?.("Wait for the running turn to finish.");
      return;
    }
    const intent = parseChatIntent({
      text: request.text,
      selectedText: request.selectedText,
      responseQuote: request.responseQuote,
    });
    if (intent.type === "research") {
      activeResearch = {
        itemId: request.itemId,
        sessionId: request.session.sessionId,
        process: null,
        cancelled: false,
      };
      const researchSink: ChatFlowSink = {
        ...sink,
        onProcess: (process) => {
          if (
            activeResearch?.itemId === request.itemId &&
            activeResearch.sessionId === request.session.sessionId
          ) {
            activeResearch.process = process;
            if (process && activeResearch.cancelled) {
              process.kill();
            }
          }
          sink.onProcess?.(process);
        },
      };
      try {
        await this.deps.runResearch(request, researchSink);
      } finally {
        if (
          activeResearch?.itemId === request.itemId &&
          activeResearch.sessionId === request.session.sessionId
        ) {
          activeResearch = undefined;
        }
      }
      return;
    }

    this.deps.store.addMessage(
      request.itemId,
      {
        role: "user",
        content: request.displayContent,
        contextPapers: request.mentionedPapers,
        imageRefs: request.imageRefs.map((ref) => ({ ...ref })),
      },
      request.session.sessionId,
    );
    if (intent.type === "help") {
      activeLocalTurns += 1;
      this.deps.store.addMessage(
        request.itemId,
        {
          role: "assistant",
          content: intent.message,
          model: "Zotero Agent",
        },
        request.session.sessionId,
      );
      this.deps.store.touchSession(request.itemId);
      sink.onChanged?.(request.itemId);
      try {
        await this.persistLocalTurn(request, intent.message, "command help");
      } finally {
        activeLocalTurns = Math.max(0, activeLocalTurns - 1);
      }
      return;
    }

    const now = this.now();
    const action: AgentActionCard = {
      version: 1,
      id: this.newActionId(),
      kind: intent.kind,
      state: "proposed",
      trigger: {
        source: intent.trigger,
        text: request.text,
      },
      capabilities: ["codex.read", "vault.write"],
      request: {
        itemId: request.itemId,
        itemKey: request.paper.itemKey,
        pdfItemId: request.pdfItemId,
        sessionId: request.session.sessionId,
        paperTitle: request.paper.title,
        text: request.text,
        conversationText: request.conversationDisplayContent,
        selectedText: request.selectedText,
        responseQuote: request.responseQuote,
        mentionedPapers: request.mentionedPapers.map((paper) => ({
          ...paper,
        })),
        images: request.imageRefs.map(
          ({ previewUrl: _previewUrl, ...image }) => ({ ...image }),
        ),
        content: intent.content,
        contentSource: intent.contentSource,
        modelSlug: request.session.modelSlug,
        reasoningEffort: request.session.reasoningEffort,
      },
      target: {
        itemKey: request.paper.itemKey,
        path: `${request.paper.itemKey}/notes.md`,
        section: "Thinking",
      },
      createdAt: now,
      updatedAt: now,
    };
    this.deps.store.addMessage(
      request.itemId,
      {
        role: "assistant",
        content: "",
        model: "Codex",
        action,
      },
      request.session.sessionId,
    );
    sink.onChanged?.(request.itemId);
    if (intent.execution === "direct") {
      await this.executeAction(action, sink, {
        itemId: request.itemId,
        itemKey: request.paper.itemKey,
        sessionId: request.session.sessionId,
      });
    }
  }

  async decide(
    actionId: string,
    decision: ActionDecision,
    sink: ChatFlowSink,
  ): Promise<void> {
    const found = this.deps.store.findAction(actionId);
    if (!found) return;
    if (decision === "dismiss") {
      if (
        found.action.state !== "proposed" &&
        found.action.state !== "failed"
      ) {
        return;
      }
      this.deps.store.updateAction(found.itemId, actionId, (action) =>
        transitionAgentAction(action, "dismissed"),
      );
      this.deps.store.touchSession(found.itemId);
      sink.onChanged?.(found.itemId);
      return;
    }
    if (
      (decision === "confirm" && found.action.state === "proposed") ||
      (decision === "retry" &&
        (found.action.state === "failed" || found.action.state === "cancelled"))
    ) {
      await this.executeAction(found.action, sink, found);
    }
  }

  cancel(itemId: number, sessionId: string): void {
    const key = sessionKey(itemId, sessionId);
    const active = activeActionsBySession.get(key);
    if (!active || !active.cancellable) {
      if (
        activeResearch?.itemId === itemId &&
        activeResearch.sessionId === sessionId
      ) {
        activeResearch.cancelled = true;
        try {
          activeResearch.process?.kill();
        } catch {
          // The process may already have exited.
        }
      }
      return;
    }
    try {
      active.process?.kill();
    } catch {
      // The process may already have exited.
    }
    this.deps.store.updateAction(itemId, active.actionId, (action) =>
      action.state === "running"
        ? transitionAgentAction(action, "cancelled", {
            error: {
              code: "cancelled",
              message: "Cancelled by user.",
              retryable: true,
            },
          })
        : action,
    );
    this.deps.store.touchSession(itemId);
  }

  isActive(itemId: number, sessionId: string): boolean {
    return (
      activeActionsBySession.has(sessionKey(itemId, sessionId)) ||
      (activeResearch?.itemId === itemId &&
        activeResearch.sessionId === sessionId)
    );
  }

  private async executeAction(
    original: AgentActionCard,
    sink: ChatFlowSink,
    location: {
      itemId: number;
      itemKey: string;
      sessionId: string;
    },
  ): Promise<void> {
    const itemId = location.itemId;
    const actionId = original.id;
    const key = sessionKey(itemId, location.sessionId);
    if (!actionMatchesLocation(original, location)) {
      this.deps.store.updateAction(itemId, actionId, (action) => ({
        ...action,
        state: "failed",
        statusText: undefined,
        result: undefined,
        error: {
          code: "invalid-snapshot",
          message:
            "This action no longer matches its paper or chat session and cannot be retried.",
          retryable: false,
        },
        updatedAt: Date.now(),
      }));
      this.deps.store.touchSession(itemId);
      sink.onChanged?.(itemId);
      return;
    }
    const existing = activeActionsBySession.values().next().value as
      | ActiveActionExecution
      | undefined;
    if (existing || activeResearch || activeLocalTurns > 0) {
      const sameExecution =
        existing?.actionId === actionId &&
        existing?.itemId === itemId &&
        activeActionsBySession.has(key);
      if (!sameExecution) {
        this.deps.store.updateAction(itemId, actionId, (action) => ({
          ...action,
          state: "failed",
          statusText: undefined,
          result: undefined,
          error: {
            code: "action-busy",
            message:
              "Another action is already running in this chat. Retry after it finishes.",
            retryable: true,
          },
          updatedAt: Date.now(),
        }));
        this.deps.store.touchSession(itemId);
        sink.onChanged?.(itemId);
      } else {
        sink.onStatus?.("The previous action is still stopping.");
      }
      return;
    }
    const executionId = ++nextExecutionId;
    this.deps.store.updateAction(itemId, actionId, (action) =>
      transitionAgentAction(action, "running", {
        statusText: "Organizing Reader Thinking...",
      }),
    );
    activeActionsBySession.set(key, {
      actionId,
      executionId,
      itemId,
      process: null,
      cancellable: true,
    });
    sink.onRunning?.(true);
    sink.onStatus?.("Organizing Reader Thinking...");
    sink.onChanged?.(itemId);
    let snapshots: Awaited<ReturnType<typeof captureVaultTextFiles>> | null =
      null;
    let commitReceipt: Awaited<ReturnType<typeof commitVaultPaths>> = null;
    try {
      const result = await this.deps.organizeNote({
        actionId,
        itemKey: original.request.itemKey,
        paperTitle: original.request.paperTitle,
        content: String(original.request.content || ""),
        model: original.request.modelSlug,
        reasoningEffort: original.request.reasoningEffort,
        onStatus: sink.onStatus,
        onProcess: (process) => {
          const current = this.deps.store.findAction(actionId);
          if (current?.action.state === "cancelled") {
            process.kill();
            return;
          }
          const active = activeActionsBySession.get(key);
          if (active) active.process = process;
          sink.onProcess?.(process);
        },
      });
      const current = this.deps.store.findAction(actionId);
      if (current?.action.state === "cancelled") {
        throw new Error("Cancelled by user.");
      }
      this.deps.store.updateAction(itemId, actionId, (action) => ({
        ...action,
        statusText: "Saving to the Knowledge Vault...",
        updatedAt: Date.now(),
      }));
      sink.onStatus?.("Saving to the Knowledge Vault...");
      sink.onChanged?.(itemId);
      const notePath = `${original.request.itemKey}/notes.md`;
      const conversationPath = `${
        original.request.itemKey
      }/conversations/${safePathSegment(original.request.sessionId)}.md`;
      await (this.deps.assertVaultPathsClean || assertVaultPathsClean)([
        notePath,
        conversationPath,
      ]);
      snapshots = await (
        this.deps.captureVaultTextFiles || captureVaultTextFiles
      )([notePath, conversationPath]);
      this.throwIfCancelled(actionId);
      await (this.deps.appendPaperNote || appendPaperNote)({
        itemKey: original.request.itemKey,
        author: "agent, user-confirmed",
        section: result.section,
        content: result.markdown,
        actionId,
        commit: false,
      });
      this.throwIfCancelled(actionId);
      await this.deps.appendConversationTurn({
        itemKey: original.request.itemKey,
        sessionId: original.request.sessionId,
        userMessage: original.request.conversationText || original.request.text,
        assistantMessage: result.summary,
      });
      this.throwIfCancelled(actionId);
      const active = activeActionsBySession.get(key);
      if (active) active.cancellable = false;
      this.deps.store.updateAction(itemId, actionId, (action) => ({
        ...action,
        statusText: "Committing Vault changes...",
        updatedAt: Date.now(),
      }));
      sink.onStatus?.("Committing Vault changes...");
      sink.onChanged?.(itemId);
      commitReceipt = await (this.deps.commitVaultPaths || commitVaultPaths)(
        `action: note ${original.request.itemKey}`,
        [notePath, conversationPath],
      );
      this.deps.store.updateAction(itemId, actionId, (action) =>
        transitionAgentAction(action, "completed", {
          result: {
            summary: result.summary,
            targetPath: result.targetPath,
            section: result.section,
            committed: Boolean(commitReceipt),
            commitReceipt: commitReceipt || undefined,
          },
        }),
      );
    } catch (error) {
      if (snapshots && !commitReceipt) {
        try {
          await (this.deps.restoreVaultTextFiles || restoreVaultTextFiles)(
            snapshots,
          );
        } catch (restoreError) {
          error = new Error(
            `${error instanceof Error ? error.message : String(error)}; rollback failed: ${
              restoreError instanceof Error
                ? restoreError.message
                : String(restoreError)
            }`,
          );
        }
      }
      const current = this.deps.store.findAction(actionId);
      const cancelled = current?.action.state === "cancelled";
      const logError = await this.persistTerminalConversation(
        original,
        cancelled
          ? "[Action cancelled] Cancelled by user."
          : `[Action failed] ${
              error instanceof Error ? error.message : String(error)
            }`,
        cancelled ? "cancelled" : "failed",
      );
      if (cancelled) {
        if (logError) {
          this.deps.store.updateAction(itemId, actionId, (action) => ({
            ...action,
            error: {
              code: "cancelled-log-failed",
              message: `Cancelled by user. Conversation Log was not saved: ${logError}`,
              retryable: true,
            },
            updatedAt: Date.now(),
          }));
        }
        return;
      }
      this.deps.store.updateAction(itemId, actionId, (action) =>
        transitionAgentAction(action, "failed", {
          error: {
            code: "execution-failed",
            message: [
              error instanceof Error ? error.message : String(error),
              logError ? `Conversation Log was not saved: ${logError}` : "",
            ]
              .filter(Boolean)
              .join(" "),
            retryable: true,
          },
        }),
      );
    } finally {
      const active = activeActionsBySession.get(key);
      if (active?.executionId === executionId) {
        activeActionsBySession.delete(key);
        this.deps.store.touchSession(itemId);
        sink.onProcess?.(null);
        sink.onRunning?.(false);
        sink.onChanged?.(itemId);
      }
    }
  }

  private async persistTerminalConversation(
    action: AgentActionCard,
    assistantMessage: string,
    outcome: "cancelled" | "failed",
  ): Promise<string | null> {
    let snapshots: Awaited<ReturnType<typeof captureVaultTextFiles>> | null =
      null;
    try {
      const conversationPath = `${
        action.request.itemKey
      }/conversations/${safePathSegment(action.request.sessionId)}.md`;
      await (this.deps.assertVaultPathsClean || assertVaultPathsClean)([
        conversationPath,
      ]);
      snapshots = await (
        this.deps.captureVaultTextFiles || captureVaultTextFiles
      )([conversationPath]);
      await this.deps.appendConversationTurn({
        itemKey: action.request.itemKey,
        sessionId: action.request.sessionId,
        userMessage: action.request.conversationText || action.request.text,
        assistantMessage,
      });
      await (this.deps.commitVaultPaths || commitVaultPaths)(
        `action: note ${outcome} ${action.request.itemKey}`,
        [conversationPath],
      );
      return null;
    } catch (error) {
      if (!snapshots) {
        return error instanceof Error ? error.message : String(error);
      }
      try {
        await (this.deps.restoreVaultTextFiles || restoreVaultTextFiles)(
          snapshots,
        );
      } catch (restoreError) {
        return `${
          error instanceof Error ? error.message : String(error)
        }; rollback failed: ${
          restoreError instanceof Error
            ? restoreError.message
            : String(restoreError)
        }`;
      }
      return error instanceof Error ? error.message : String(error);
    }
  }

  private async persistLocalTurn(
    request: ChatSubmission,
    assistantMessage: string,
    label: string,
  ): Promise<void> {
    const conversationPath = `${
      request.paper.itemKey
    }/conversations/${safePathSegment(request.session.sessionId)}.md`;
    let snapshots: Awaited<ReturnType<typeof captureVaultTextFiles>> | null =
      null;
    try {
      await (this.deps.assertVaultPathsClean || assertVaultPathsClean)([
        conversationPath,
      ]);
      snapshots = await (
        this.deps.captureVaultTextFiles || captureVaultTextFiles
      )([conversationPath]);
      await this.deps.appendConversationTurn({
        itemKey: request.paper.itemKey,
        sessionId: request.session.sessionId,
        userMessage: request.conversationDisplayContent,
        assistantMessage,
      });
      await (this.deps.commitVaultPaths || commitVaultPaths)(
        `chat: ${label} ${request.paper.itemKey}`,
        [conversationPath],
      );
    } catch {
      if (!snapshots) return;
      try {
        await (this.deps.restoreVaultTextFiles || restoreVaultTextFiles)(
          snapshots,
        );
      } catch {
        // ChatStore remains the UI source of truth when Vault logging fails.
      }
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private throwIfCancelled(actionId: string): void {
    if (this.deps.store.findAction(actionId)?.action.state === "cancelled") {
      throw new Error("Cancelled by user.");
    }
  }

  private newActionId(): string {
    return (
      this.deps.newActionId?.() ||
      `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }
}

function sessionKey(itemId: number, sessionId: string): string {
  return `${itemId}:${sessionId}`;
}

function actionMatchesLocation(
  action: AgentActionCard,
  location: { itemId: number; itemKey: string; sessionId: string },
): boolean {
  return (
    action.request.itemId === location.itemId &&
    action.request.itemKey === location.itemKey &&
    action.request.sessionId === location.sessionId &&
    action.target?.itemKey === location.itemKey &&
    action.target.path === `${location.itemKey}/notes.md`
  );
}
