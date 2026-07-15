import type { ChatMessage, ChatSession, PaperContext } from "../../addon";
import type { LocalImageRef } from "../local-images";
import type { PaperVaultMeta, RunningLineProcess } from "../codex";
import {
  appendConversationTurn,
  appendPaperNote,
  assertVaultPathsClean,
  captureVaultTextFiles,
  commitVaultPaths,
  getVaultHeadSha,
  revertVaultCommit,
  restoreVaultPathsFromHead,
  restoreVaultTextFiles,
  verifyVaultCommitReceipt,
} from "../codex";
import { safePathSegment } from "../codex/vault-format";
import { organizePaperNote } from "./note";
import {
  prepareLocalKnowledgeAction,
  type PreparedLocalKnowledgeAction,
} from "./local-knowledge";
import { parseChatIntent } from "./intent";
import {
  transitionAgentAction,
  type AgentActionCard,
  type AgentActionKind,
  type AgentActionTriggerSource,
  type NoteContentSource,
} from "./types";

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

export type DirectActionDescriptor =
  | { kind: "paper.rating.set"; rating: number }
  | { kind: "paper.depth.set"; targetTier: "L0" | "L1" | "L2" };

export type ChatFlowSink = {
  onChanged?: (itemId: number) => void;
  onRunning?: (running: boolean) => void;
  onStatus?: (text: string) => void;
  onProcess?: (process: RunningLineProcess | null) => void;
};

export interface ChatSendFlow {
  canSubmit(): boolean;
  submit(request: ChatSubmission, sink: ChatFlowSink): Promise<void>;
  submitAction(
    request: ChatSubmission,
    descriptor: DirectActionDescriptor,
    sink: ChatFlowSink,
  ): Promise<void>;
  decide(
    actionId: string,
    decision: ActionDecision,
    sink: ChatFlowSink,
  ): Promise<void>;
  cancel(itemId: number, sessionId: string): void;
  isActive(itemId: number, sessionId: string): boolean;
  undo(actionId: string, sink: ChatFlowSink): Promise<void>;
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
  prepareLocalKnowledgeAction?: typeof prepareLocalKnowledgeAction;
  appendConversationTurn: typeof appendConversationTurn;
  appendPaperNote?: typeof appendPaperNote;
  assertVaultPathsClean?: typeof assertVaultPathsClean;
  captureVaultTextFiles?: typeof captureVaultTextFiles;
  restoreVaultTextFiles?: typeof restoreVaultTextFiles;
  restoreVaultPathsFromHead?: typeof restoreVaultPathsFromHead;
  commitVaultPaths?: typeof commitVaultPaths;
  getVaultHeadSha?: typeof getVaultHeadSha;
  revertVaultCommit?: typeof revertVaultCommit;
  verifyVaultCommitReceipt?: typeof verifyVaultCommitReceipt;
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
        const error = await this.persistLocalTurn(
          request,
          intent.message,
          "command help",
        );
        if (error) {
          sink.onStatus?.(`Conversation Log was not saved: ${error}`);
        }
      } finally {
        activeLocalTurns = Math.max(0, activeLocalTurns - 1);
      }
      return;
    }

    const action = this.buildActionCard(request, {
      kind: intent.kind,
      trigger: intent.trigger,
      content: intent.content,
      contentSource: intent.contentSource,
      rating: intent.rating,
      targetTier: intent.targetTier,
    });
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

  async submitAction(
    request: ChatSubmission,
    descriptor: DirectActionDescriptor,
    sink: ChatFlowSink,
  ): Promise<void> {
    if (!this.canSubmit()) {
      sink.onStatus?.("Wait for the running turn to finish.");
      return;
    }
    this.deps.store.addMessage(
      request.itemId,
      {
        role: "user",
        content: request.displayContent,
      },
      request.session.sessionId,
    );
    const action = this.buildActionCard(request, {
      kind: descriptor.kind,
      trigger: "ui-control",
      rating:
        descriptor.kind === "paper.rating.set" ? descriptor.rating : undefined,
      targetTier:
        descriptor.kind === "paper.depth.set"
          ? descriptor.targetTier
          : undefined,
    });
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
    await this.executeAction(action, sink, {
      itemId: request.itemId,
      itemKey: request.paper.itemKey,
      sessionId: request.session.sessionId,
    });
  }

  private buildActionCard(
    request: ChatSubmission,
    descriptor: {
      kind: AgentActionKind;
      trigger: AgentActionTriggerSource;
      content?: string;
      contentSource?: NoteContentSource;
      rating?: number;
      targetTier?: "L0" | "L1" | "L2";
    },
  ): AgentActionCard {
    const now = this.now();
    return {
      version: 1,
      id: this.newActionId(),
      kind: descriptor.kind,
      state: "proposed",
      trigger: {
        source: descriptor.trigger,
        text: request.text,
      },
      capabilities:
        descriptor.kind === "paper.rating.set"
          ? ["vault.write"]
          : ["codex.read", "vault.write"],
      request: {
        itemId: request.itemId,
        itemKey: request.paper.itemKey,
        pdfItemId: request.pdfItemId,
        sessionId: request.session.sessionId,
        paperTitle: request.paper.title,
        paper: {
          itemId: request.paper.itemId,
          itemKey: request.paper.itemKey,
          title: request.paper.title,
          creators: request.paper.creators,
          year: request.paper.year,
          abstract: request.paper.abstract,
          zoteroCollections: request.paper.zoteroCollections,
          zoteroTags: request.paper.zoteroTags,
          paperKeywords: request.paper.paperKeywords,
        },
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
        content: descriptor.content,
        contentSource: descriptor.contentSource,
        rating: descriptor.rating,
        targetTier: descriptor.targetTier,
        modelSlug: request.session.modelSlug,
        reasoningEffort: request.session.reasoningEffort,
      },
      target:
        descriptor.kind === "note.organize"
          ? {
              itemKey: request.paper.itemKey,
              path: `${request.paper.itemKey}/notes.md`,
              section: "Thinking",
            }
          : {
              itemKey: request.paper.itemKey,
              path: `${request.paper.itemKey}/memory.md`,
              section: "Overview",
            },
      createdAt: now,
      updatedAt: now,
    };
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

  async undo(actionId: string, sink: ChatFlowSink): Promise<void> {
    if (!this.canSubmit()) {
      sink.onStatus?.("Wait for the running turn to finish.");
      return;
    }
    const found = this.deps.store.findAction(actionId);
    const receipt = found?.action.result?.commitReceipt;
    if (
      !found ||
      found.action.state !== "completed" ||
      !receipt ||
      (found.action.kind !== "note.organize" &&
        found.action.kind !== "paper.rating.set" &&
        found.action.kind !== "paper.depth.set")
    ) {
      return;
    }
    activeLocalTurns += 1;
    try {
      try {
        const undoReceipt =
          found.action.kind === "note.organize"
            ? await this.undoNoteAction(found.action)
            : await (this.deps.revertVaultCommit || revertVaultCommit)(
                receipt.commitSha,
                receipt.changedPaths,
                receipt.parentSha,
              );
        this.deps.store.updateAction(found.itemId, actionId, (action) =>
          transitionAgentAction(action, "undone", {
            result: {
              ...(action.result || { summary: "Undone." }),
              summary: "Action undone.",
              undoCommitReceipt: undoReceipt,
            },
          }),
        );
      } catch (error) {
        this.deps.store.updateAction(found.itemId, actionId, (action) => ({
          ...action,
          error: {
            code: "undo-failed",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
          updatedAt: Date.now(),
        }));
      }
      this.deps.store.touchSession(found.itemId);
      sink.onChanged?.(found.itemId);
    } finally {
      activeLocalTurns = Math.max(0, activeLocalTurns - 1);
    }
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
        statusText: actionRunningStatus(original.kind),
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
    sink.onStatus?.(actionRunningStatus(original.kind));
    sink.onChanged?.(itemId);
    if (
      original.kind === "paper.rating.set" ||
      original.kind === "paper.depth.set"
    ) {
      await this.executeLocalKnowledgeAction(original, sink, key, executionId);
      return;
    }
    let snapshots: Awaited<ReturnType<typeof captureVaultTextFiles>> | null =
      null;
    let commitReceipt: Awaited<ReturnType<typeof commitVaultPaths>> = null;
    let expectedHeadSha = "";
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
      expectedHeadSha = await (this.deps.getVaultHeadSha || getVaultHeadSha)();
      await (this.deps.assertVaultPathsClean || assertVaultPathsClean)([
        notePath,
        conversationPath,
      ]);
      snapshots = await (
        this.deps.captureVaultTextFiles || captureVaultTextFiles
      )([notePath, conversationPath]);
      if (
        (await (this.deps.getVaultHeadSha || getVaultHeadSha)()) !==
        expectedHeadSha
      ) {
        throw new Error("Vault has newer updates.");
      }
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
        expectedHeadSha,
        true,
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
          await this.rollbackSnapshots(snapshots, expectedHeadSha);
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

  private async executeLocalKnowledgeAction(
    action: AgentActionCard,
    sink: ChatFlowSink,
    key: string,
    executionId: number,
  ): Promise<void> {
    const itemId = action.request.itemId;
    let snapshots: Awaited<ReturnType<typeof captureVaultTextFiles>> | null =
      null;
    let commitReceipt: Awaited<ReturnType<typeof commitVaultPaths>> = null;
    let expectedHeadSha = "";
    try {
      const prepared = await (
        this.deps.prepareLocalKnowledgeAction || prepareLocalKnowledgeAction
      )(action, {
        onStatus: sink.onStatus,
        onProcess: (process) => {
          const current = this.deps.store.findAction(action.id);
          if (current?.action.state === "cancelled") {
            process.kill();
            return;
          }
          const active = activeActionsBySession.get(key);
          if (active) active.process = process;
          sink.onProcess?.(process);
        },
      });
      expectedHeadSha = prepared.expectedHeadSha || "";
      this.throwIfCancelled(action.id);
      const applied = await this.applyPreparedLocalAction(
        action,
        prepared,
        sink,
        (captured) => {
          snapshots = captured;
        },
      );
      commitReceipt = applied.commitReceipt;
      this.deps.store.updateAction(itemId, action.id, (current) =>
        transitionAgentAction(current, "completed", {
          result: {
            summary: applied.result.summary,
            targetPath: applied.result.targetPath,
            section: applied.result.section,
            committed: Boolean(commitReceipt),
            commitReceipt: commitReceipt || undefined,
          },
        }),
      );
    } catch (error) {
      if (snapshots && !commitReceipt) {
        try {
          await this.rollbackSnapshots(snapshots, expectedHeadSha);
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
      const current = this.deps.store.findAction(action.id);
      const cancelled = current?.action.state === "cancelled";
      const logError = await this.persistTerminalConversation(
        action,
        cancelled
          ? "[Action cancelled] Cancelled by user."
          : `[Action failed] ${
              error instanceof Error ? error.message : String(error)
            }`,
        cancelled ? "cancelled" : "failed",
      );
      if (cancelled && logError) {
        this.deps.store.updateAction(itemId, action.id, (currentAction) => ({
          ...currentAction,
          error: {
            code: "cancelled-log-failed",
            message: `Cancelled by user. Conversation Log was not saved: ${logError}`,
            retryable: true,
          },
          updatedAt: Date.now(),
        }));
      } else if (!cancelled) {
        this.deps.store.updateAction(itemId, action.id, (currentAction) =>
          transitionAgentAction(currentAction, "failed", {
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
      }
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

  private async applyPreparedLocalAction(
    action: AgentActionCard,
    prepared: PreparedLocalKnowledgeAction,
    sink: ChatFlowSink,
    onSnapshots: (
      snapshots: Awaited<ReturnType<typeof captureVaultTextFiles>>,
    ) => void,
  ) {
    if (!prepared.paths.length) {
      const result = await prepared.apply();
      const logError = await this.persistLocalTurn(
        submissionFromAction(action),
        result.summary,
        "action no-op",
      );
      if (logError) {
        throw new Error(`Conversation Log was not saved: ${logError}`);
      }
      return { result, commitReceipt: null };
    }
    const conversationPath = `${
      action.request.itemKey
    }/conversations/${safePathSegment(action.request.sessionId)}.md`;
    const paths = [...prepared.paths, conversationPath];
    if (prepared.expectedHeadSha) {
      const currentHead = await (
        this.deps.getVaultHeadSha || getVaultHeadSha
      )();
      if (currentHead !== prepared.expectedHeadSha) {
        throw new Error("Vault has newer updates.");
      }
    }
    await (this.deps.assertVaultPathsClean || assertVaultPathsClean)(paths);
    const snapshots = await (
      this.deps.captureVaultTextFiles || captureVaultTextFiles
    )(paths);
    onSnapshots(snapshots);
    if (prepared.expectedHeadSha) {
      const currentHead = await (
        this.deps.getVaultHeadSha || getVaultHeadSha
      )();
      if (currentHead !== prepared.expectedHeadSha) {
        throw new Error("Vault has newer updates.");
      }
    }
    this.throwIfCancelled(action.id);
    const result = await prepared.apply();
    this.throwIfCancelled(action.id);
    await this.deps.appendConversationTurn({
      itemKey: action.request.itemKey,
      sessionId: action.request.sessionId,
      userMessage: action.request.conversationText || action.request.text,
      assistantMessage: result.summary,
    });
    this.throwIfCancelled(action.id);
    const active = activeActionsBySession.get(
      sessionKey(action.request.itemId, action.request.sessionId),
    );
    if (active) active.cancellable = false;
    sink.onStatus?.("Committing Vault changes...");
    const commitReceipt = await (
      this.deps.commitVaultPaths || commitVaultPaths
    )(prepared.commitMessage, paths, prepared.expectedHeadSha, true);
    return { result, commitReceipt };
  }

  private async persistTerminalConversation(
    action: AgentActionCard,
    assistantMessage: string,
    outcome: "cancelled" | "failed",
  ): Promise<string | null> {
    let snapshots: Awaited<ReturnType<typeof captureVaultTextFiles>> | null =
      null;
    let expectedHeadSha = "";
    try {
      const conversationPath = `${
        action.request.itemKey
      }/conversations/${safePathSegment(action.request.sessionId)}.md`;
      expectedHeadSha = await (this.deps.getVaultHeadSha || getVaultHeadSha)();
      await (this.deps.assertVaultPathsClean || assertVaultPathsClean)([
        conversationPath,
      ]);
      snapshots = await (
        this.deps.captureVaultTextFiles || captureVaultTextFiles
      )([conversationPath]);
      if (
        (await (this.deps.getVaultHeadSha || getVaultHeadSha)()) !==
        expectedHeadSha
      ) {
        throw new Error("Vault has newer updates.");
      }
      await this.deps.appendConversationTurn({
        itemKey: action.request.itemKey,
        sessionId: action.request.sessionId,
        userMessage: action.request.conversationText || action.request.text,
        assistantMessage,
      });
      await (this.deps.commitVaultPaths || commitVaultPaths)(
        `action: note ${outcome} ${action.request.itemKey}`,
        [conversationPath],
        expectedHeadSha,
        true,
      );
      return null;
    } catch (error) {
      if (!snapshots) {
        return error instanceof Error ? error.message : String(error);
      }
      try {
        await this.rollbackSnapshots(snapshots, expectedHeadSha);
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

  private async undoNoteAction(action: AgentActionCard) {
    const receipt = action.result?.commitReceipt;
    if (!receipt) throw new Error("This action has no Vault commit.");
    await (this.deps.verifyVaultCommitReceipt || verifyVaultCommitReceipt)(
      receipt,
    );
    const head = await (this.deps.getVaultHeadSha || getVaultHeadSha)();
    if (head !== receipt.commitSha) {
      throw new Error("Vault has newer updates.");
    }
    const notesPath = `${action.request.itemKey}/notes.md`;
    await (this.deps.assertVaultPathsClean || assertVaultPathsClean)([
      notesPath,
    ]);
    const snapshots = await (
      this.deps.captureVaultTextFiles || captureVaultTextFiles
    )([notesPath]);
    try {
      await (this.deps.appendPaperNote || appendPaperNote)({
        itemKey: action.request.itemKey,
        author: "agent, user-confirmed",
        section:
          action.result?.section === "Reading Context" ||
          action.result?.section === "Actions"
            ? action.result.section
            : "Thoughts and Critique",
        content: `> Retracted action \`${action.id}\`. The original entry remains in history.`,
        actionId: action.id,
        commit: false,
      });
      const undoReceipt = await (
        this.deps.commitVaultPaths || commitVaultPaths
      )(
        `undo: note ${action.request.itemKey}`,
        [notesPath],
        receipt.commitSha,
        true,
      );
      if (!undoReceipt) throw new Error("Note retraction produced no commit.");
      return undoReceipt;
    } catch (error) {
      await this.rollbackSnapshots(snapshots, receipt.commitSha);
      throw error;
    }
  }

  private async persistLocalTurn(
    request: ChatSubmission,
    assistantMessage: string,
    label: string,
  ): Promise<string | null> {
    const conversationPath = `${
      request.paper.itemKey
    }/conversations/${safePathSegment(request.session.sessionId)}.md`;
    let snapshots: Awaited<ReturnType<typeof captureVaultTextFiles>> | null =
      null;
    let expectedHeadSha = "";
    try {
      expectedHeadSha = await (this.deps.getVaultHeadSha || getVaultHeadSha)();
      await (this.deps.assertVaultPathsClean || assertVaultPathsClean)([
        conversationPath,
      ]);
      snapshots = await (
        this.deps.captureVaultTextFiles || captureVaultTextFiles
      )([conversationPath]);
      if (
        (await (this.deps.getVaultHeadSha || getVaultHeadSha)()) !==
        expectedHeadSha
      ) {
        throw new Error("Vault has newer updates.");
      }
      await this.deps.appendConversationTurn({
        itemKey: request.paper.itemKey,
        sessionId: request.session.sessionId,
        userMessage: request.conversationDisplayContent,
        assistantMessage,
      });
      await (this.deps.commitVaultPaths || commitVaultPaths)(
        `chat: ${label} ${request.paper.itemKey}`,
        [conversationPath],
        expectedHeadSha,
        true,
      );
      return null;
    } catch (error) {
      if (!snapshots) {
        return error instanceof Error ? error.message : String(error);
      }
      try {
        await this.rollbackSnapshots(snapshots, expectedHeadSha);
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

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async rollbackSnapshots(
    snapshots: Awaited<ReturnType<typeof captureVaultTextFiles>>,
    expectedHeadSha: string,
  ): Promise<void> {
    const currentHead = await (this.deps.getVaultHeadSha || getVaultHeadSha)();
    if (expectedHeadSha && currentHead !== expectedHeadSha) {
      await (this.deps.restoreVaultPathsFromHead || restoreVaultPathsFromHead)(
        snapshots.map((snapshot) => snapshot.relativePath),
      );
      return;
    }
    await (this.deps.restoreVaultTextFiles || restoreVaultTextFiles)(snapshots);
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
    action.target.path ===
      `${location.itemKey}/${
        action.kind === "note.organize" ? "notes.md" : "memory.md"
      }`
  );
}

function actionRunningStatus(kind: AgentActionCard["kind"]): string {
  if (kind === "paper.rating.set") return "Updating paper rating...";
  if (kind === "paper.depth.set") return "Preparing depth transition...";
  return "Organizing Reader Thinking...";
}

function submissionFromAction(action: AgentActionCard): ChatSubmission {
  const paper = action.request.paper;
  if (!paper || !paper.itemId) {
    throw new Error("The action is missing its paper snapshot.");
  }
  return {
    itemId: action.request.itemId,
    paper: { ...paper, itemId: paper.itemId },
    pdfItemId: action.request.pdfItemId || 0,
    session: {
      sessionId: action.request.sessionId,
      modelSlug: action.request.modelSlug,
      reasoningEffort: action.request.reasoningEffort,
    },
    text: action.request.text,
    selectedText: action.request.selectedText || "",
    responseQuote: action.request.responseQuote || "",
    mentionedPapers: action.request.mentionedPapers || [],
    imageRefs: action.request.images || [],
    imagePaths: [],
    priorVisibleMessages: [],
    displayContent: action.request.text,
    conversationDisplayContent:
      action.request.conversationText || action.request.text,
  };
}
