import type { CodexReasoningEffort } from "../codex/context-window";

export type AgentActionKind =
  | "note.organize"
  | "code.discover"
  | "code.analyze"
  | "topic.synthesize"
  | "paper.depth.set"
  | "paper.rating.set"
  | "paper.record.build"
  | "paper.record.repair"
  | "paper.pdf.enrich"
  | "paper.relationship.add";

export type AgentActionState =
  | "proposed"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "dismissed"
  | "undone";

export type AgentActionTriggerSource =
  | "slash-command"
  | "explicit-instruction"
  | "bare-url"
  | "codex-suggestion";

export type AgentActionCapability =
  | "codex.read"
  | "web.search"
  | "network.git"
  | "vault.write";

export type NoteContentSource =
  | "command"
  | "selection"
  | "response-quote"
  | "message";

export type AgentActionPaperSnapshot = {
  itemKey: string;
  title: string;
  creators?: string;
  year?: string;
};

export type AgentActionImageSnapshot = {
  id: string;
  sessionId?: string;
  relativePath: string;
  name: string;
  mimeType: string;
  pageNumber?: number;
};

export type AgentActionRequestSnapshot = {
  itemId: number;
  itemKey: string;
  pdfItemId?: number;
  sessionId: string;
  paperTitle: string;
  text: string;
  conversationText?: string;
  selectedText?: string;
  responseQuote?: string;
  mentionedPapers?: AgentActionPaperSnapshot[];
  images?: AgentActionImageSnapshot[];
  content?: string;
  contentSource?: NoteContentSource;
  modelSlug?: string;
  reasoningEffort?: CodexReasoningEffort;
};

export type VaultCommitReceipt = {
  commitSha: string;
  parentSha: string;
  changedPaths: string[];
};

export type AgentActionResult = {
  summary: string;
  targetPath?: string;
  section?: string;
  committed?: boolean;
  commitReceipt?: VaultCommitReceipt;
};

export type AgentActionCard = {
  version: 1;
  id: string;
  kind: AgentActionKind;
  state: AgentActionState;
  trigger: {
    source: AgentActionTriggerSource;
    text: string;
  };
  capabilities: AgentActionCapability[];
  request: AgentActionRequestSnapshot;
  statusText?: string;
  result?: AgentActionResult;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  target?: {
    itemKey: string;
    path: string;
    section?: string;
  };
  createdAt: number;
  updatedAt: number;
};

type TransitionOptions = {
  now?: number;
  statusText?: string;
  result?: AgentActionResult;
  error?: AgentActionCard["error"];
};

const ALLOWED_TRANSITIONS: Record<AgentActionState, AgentActionState[]> = {
  proposed: ["running", "failed", "dismissed"],
  running: ["completed", "failed", "cancelled"],
  completed: ["undone"],
  failed: ["running", "dismissed"],
  cancelled: ["running", "dismissed"],
  dismissed: [],
  undone: [],
};

const ACTION_KINDS: AgentActionKind[] = [
  "note.organize",
  "code.discover",
  "code.analyze",
  "topic.synthesize",
  "paper.depth.set",
  "paper.rating.set",
  "paper.record.build",
  "paper.record.repair",
  "paper.pdf.enrich",
  "paper.relationship.add",
];

const ACTION_STATES: AgentActionState[] = [
  "proposed",
  "running",
  "completed",
  "failed",
  "cancelled",
  "dismissed",
  "undone",
];

const TRIGGER_SOURCES: AgentActionTriggerSource[] = [
  "slash-command",
  "explicit-instruction",
  "bare-url",
  "codex-suggestion",
];

const ACTION_CAPABILITIES: AgentActionCapability[] = [
  "codex.read",
  "web.search",
  "network.git",
  "vault.write",
];

const NOTE_CONTENT_SOURCES: NoteContentSource[] = [
  "command",
  "selection",
  "response-quote",
  "message",
];

const REASONING_EFFORTS: CodexReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export function transitionAgentAction(
  action: AgentActionCard,
  nextState: AgentActionState,
  options: TransitionOptions = {},
): AgentActionCard {
  if (!ALLOWED_TRANSITIONS[action.state].includes(nextState)) {
    throw new Error(
      `Invalid Agent Action transition: ${action.state} -> ${nextState}`,
    );
  }
  return {
    ...action,
    state: nextState,
    statusText: options.statusText,
    result: options.result,
    error: options.error,
    updatedAt: options.now ?? Date.now(),
  };
}

export function normalizeAgentAction(value: AgentActionCard): AgentActionCard {
  const action = cloneAction(value);
  if (action.state !== "running") return action;
  return {
    ...action,
    state: "failed",
    statusText: undefined,
    error: {
      code: "interrupted",
      message: "Interrupted when Zotero closed. Retry to run it again.",
      retryable: true,
    },
    updatedAt: Date.now(),
  };
}

export function normalizePersistedAgentAction(
  value: unknown,
): AgentActionCard | undefined {
  if (!value || typeof value !== "object") return undefined;
  const action = value as Partial<AgentActionCard>;
  if (
    action.version !== 1 ||
    !nonEmptyString(action.id) ||
    !ACTION_KINDS.includes(action.kind as AgentActionKind) ||
    !ACTION_STATES.includes(action.state as AgentActionState) ||
    !isValidTrigger(action.trigger) ||
    !isValidRequest(action.request) ||
    !Array.isArray(action.capabilities) ||
    !action.capabilities.every((capability) =>
      ACTION_CAPABILITIES.includes(capability),
    ) ||
    !isValidTarget(action.target, action.kind as AgentActionKind) ||
    !isValidStatePayload(action as AgentActionCard) ||
    !finiteNumber(action.createdAt) ||
    !finiteNumber(action.updatedAt)
  ) {
    return undefined;
  }
  return normalizeAgentAction(action as AgentActionCard);
}

function cloneAction(action: AgentActionCard): AgentActionCard {
  return JSON.parse(JSON.stringify(action)) as AgentActionCard;
}

function isValidTrigger(
  value: AgentActionCard["trigger"] | undefined,
): boolean {
  return Boolean(
    value &&
    TRIGGER_SOURCES.includes(value.source) &&
    typeof value.text === "string",
  );
}

function isValidRequest(
  value: AgentActionRequestSnapshot | undefined,
): boolean {
  return Boolean(
    value &&
    finiteNumber(value.itemId) &&
    value.itemId > 0 &&
    nonEmptyString(value.itemKey) &&
    nonEmptyString(value.sessionId) &&
    nonEmptyString(value.paperTitle) &&
    typeof value.text === "string" &&
    optionalString(value.conversationText) &&
    optionalString(value.selectedText) &&
    optionalString(value.responseQuote) &&
    optionalString(value.content) &&
    (value.pdfItemId === undefined ||
      (Number.isInteger(value.pdfItemId) && value.pdfItemId >= 0)) &&
    (value.contentSource === undefined ||
      NOTE_CONTENT_SOURCES.includes(value.contentSource)) &&
    optionalString(value.modelSlug) &&
    (value.reasoningEffort === undefined ||
      REASONING_EFFORTS.includes(value.reasoningEffort)) &&
    (!value.mentionedPapers ||
      (Array.isArray(value.mentionedPapers) &&
        value.mentionedPapers.every(
          (paper) =>
            nonEmptyString(paper?.itemKey) &&
            nonEmptyString(paper?.title) &&
            optionalString(paper?.creators) &&
            optionalString(paper?.year),
        ))) &&
    (!value.images ||
      (Array.isArray(value.images) &&
        value.images.every(
          (image) =>
            nonEmptyString(image?.id) &&
            nonEmptyString(image?.relativePath) &&
            nonEmptyString(image?.name) &&
            nonEmptyString(image?.mimeType) &&
            optionalString(image?.sessionId) &&
            (image?.pageNumber === undefined ||
              (Number.isInteger(image.pageNumber) && image.pageNumber > 0)),
        ))),
  );
}

function isValidTarget(
  value: AgentActionCard["target"],
  kind: AgentActionKind,
): boolean {
  if (kind === "note.organize") {
    return Boolean(
      value &&
      nonEmptyString(value.itemKey) &&
      value.path === `${value.itemKey}/notes.md` &&
      (value.section === undefined || typeof value.section === "string"),
    );
  }
  return Boolean(
    !value ||
    (nonEmptyString(value.itemKey) &&
      nonEmptyString(value.path) &&
      (value.section === undefined || typeof value.section === "string")),
  );
}

function isValidStatePayload(action: AgentActionCard): boolean {
  if (action.state === "completed") {
    return Boolean(
      action.result &&
      nonEmptyString(action.result.summary) &&
      (!action.result.commitReceipt ||
        (nonEmptyString(action.result.commitReceipt.commitSha) &&
          typeof action.result.commitReceipt.parentSha === "string" &&
          Array.isArray(action.result.commitReceipt.changedPaths) &&
          action.result.commitReceipt.changedPaths.every(nonEmptyString))),
    );
  }
  if (action.state === "failed" || action.state === "cancelled") {
    return Boolean(
      action.error &&
      nonEmptyString(action.error.code) &&
      nonEmptyString(action.error.message) &&
      typeof action.error.retryable === "boolean",
    );
  }
  return true;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
