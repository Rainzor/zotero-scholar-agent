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
  itemId?: number;
  itemKey: string;
  title: string;
  creators?: string;
  year?: string;
  abstract?: string;
  zoteroCollections?: Array<{ key: string; name: string; path: string }>;
  zoteroTags?: string[];
  paperKeywords?: string[];
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
  paper?: AgentActionPaperSnapshot;
  text: string;
  conversationText?: string;
  selectedText?: string;
  responseQuote?: string;
  mentionedPapers?: AgentActionPaperSnapshot[];
  images?: AgentActionImageSnapshot[];
  content?: string;
  contentSource?: NoteContentSource;
  rating?: number;
  targetTier?: "L0" | "L1" | "L2";
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
  undoCommitReceipt?: VaultCommitReceipt;
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
    !isValidRequestForKind(action.request, action.kind as AgentActionKind) ||
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
  if (
    !value ||
    !finiteNumber(value.itemId) ||
    value.itemId <= 0 ||
    !nonEmptyString(value.itemKey) ||
    !nonEmptyString(value.sessionId) ||
    !nonEmptyString(value.paperTitle) ||
    typeof value.text !== "string" ||
    !optionalString(value.conversationText) ||
    !optionalString(value.selectedText) ||
    !optionalString(value.responseQuote) ||
    !optionalString(value.content) ||
    !optionalString(value.modelSlug)
  ) {
    return false;
  }
  if (
    value.pdfItemId !== undefined &&
    (!Number.isInteger(value.pdfItemId) || value.pdfItemId < 0)
  ) {
    return false;
  }
  if (
    value.rating !== undefined &&
    (!Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5)
  ) {
    return false;
  }
  if (
    value.targetTier !== undefined &&
    value.targetTier !== "L0" &&
    value.targetTier !== "L1" &&
    value.targetTier !== "L2"
  ) {
    return false;
  }
  if (
    value.contentSource !== undefined &&
    !NOTE_CONTENT_SOURCES.includes(value.contentSource)
  ) {
    return false;
  }
  if (
    value.reasoningEffort !== undefined &&
    !REASONING_EFFORTS.includes(value.reasoningEffort)
  ) {
    return false;
  }
  if (value.paper && !isValidPaperSnapshot(value.paper)) return false;
  if (
    value.mentionedPapers &&
    (!Array.isArray(value.mentionedPapers) ||
      !value.mentionedPapers.every(isValidMentionedPaper))
  ) {
    return false;
  }
  if (
    value.images &&
    (!Array.isArray(value.images) || !value.images.every(isValidImageSnapshot))
  ) {
    return false;
  }
  return true;
}

function isValidPaperSnapshot(paper: AgentActionPaperSnapshot): boolean {
  return Boolean(
    finiteNumber(paper.itemId) &&
    Number(paper.itemId) > 0 &&
    nonEmptyString(paper.itemKey) &&
    nonEmptyString(paper.title) &&
    optionalString(paper.creators) &&
    optionalString(paper.year) &&
    optionalString(paper.abstract) &&
    (!paper.zoteroCollections ||
      (Array.isArray(paper.zoteroCollections) &&
        paper.zoteroCollections.every(
          (collection) =>
            nonEmptyString(collection?.key) &&
            nonEmptyString(collection?.name) &&
            typeof collection?.path === "string",
        ))) &&
    (!paper.zoteroTags ||
      (Array.isArray(paper.zoteroTags) &&
        paper.zoteroTags.every(nonEmptyString))) &&
    (!paper.paperKeywords ||
      (Array.isArray(paper.paperKeywords) &&
        paper.paperKeywords.every(nonEmptyString))),
  );
}

function isValidMentionedPaper(paper: AgentActionPaperSnapshot): boolean {
  return Boolean(
    nonEmptyString(paper?.itemKey) &&
    nonEmptyString(paper?.title) &&
    optionalString(paper?.creators) &&
    optionalString(paper?.year),
  );
}

function isValidImageSnapshot(image: AgentActionImageSnapshot): boolean {
  return Boolean(
    nonEmptyString(image?.id) &&
    nonEmptyString(image?.relativePath) &&
    nonEmptyString(image?.name) &&
    nonEmptyString(image?.mimeType) &&
    optionalString(image?.sessionId) &&
    (image?.pageNumber === undefined ||
      (Number.isInteger(image.pageNumber) && image.pageNumber > 0)),
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
  if (kind === "paper.rating.set" || kind === "paper.depth.set") {
    return Boolean(
      value &&
      nonEmptyString(value.itemKey) &&
      value.path === `${value.itemKey}/memory.md` &&
      value.section === "Overview",
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
  if (action.state === "completed" || action.state === "undone") {
    return Boolean(
      action.result &&
      nonEmptyString(action.result.summary) &&
      (!action.result.commitReceipt ||
        (isValidCommitReceipt(action.result.commitReceipt) &&
          isValidActionCommitPaths(
            action,
            action.result.commitReceipt.changedPaths,
          ))) &&
      (!action.result.undoCommitReceipt ||
        isValidCommitReceipt(action.result.undoCommitReceipt)),
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

function isValidCommitReceipt(receipt: VaultCommitReceipt): boolean {
  return Boolean(
    isFullGitObjectId(receipt.commitSha) &&
    isFullGitObjectId(receipt.parentSha) &&
    Array.isArray(receipt.changedPaths) &&
    receipt.changedPaths.length > 0 &&
    receipt.changedPaths.every(isSafeVaultRelativePath),
  );
}

function isValidActionCommitPaths(
  action: Pick<AgentActionCard, "kind" | "request">,
  paths: string[],
): boolean {
  if (!paths.every(isSafeVaultRelativePath)) return false;
  const itemKey = action.request.itemKey;
  const conversationPath = `${itemKey}/conversations/${safeSessionSegment(
    action.request.sessionId,
  )}.md`;
  if (action.kind === "note.organize") {
    return sameStringSet(paths, [`${itemKey}/notes.md`, conversationPath]);
  }
  if (action.kind === "paper.rating.set") {
    return sameStringSet(paths, [
      `${itemKey}/memory.md`,
      `${itemKey}/record.json`,
      "README.md",
      conversationPath,
    ]);
  }
  if (action.kind === "paper.depth.set") {
    const required = new Set([
      `${itemKey}/memory.md`,
      `${itemKey}/record.json`,
      conversationPath,
    ]);
    const actual = new Set(paths);
    if (![...required].every((path) => actual.has(path))) return false;
    return paths.every(
      (path) =>
        required.has(path) ||
        path === `${itemKey}/code-notes.md` ||
        path.startsWith(`${itemKey}/experiments/`),
    );
  }
  return true;
}

function isFullGitObjectId(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

function isSafeVaultRelativePath(value: string): boolean {
  if (!nonEmptyString(value)) return false;
  const path = value.replace(/\\/g, "/");
  const segments = path.split("/");
  return Boolean(
    path === value &&
    !path.startsWith("/") &&
    !path.startsWith(":") &&
    /^[a-zA-Z0-9._/-]+$/.test(path) &&
    segments.every(
      (segment) =>
        segment && segment !== "." && segment !== ".." && segment !== ".git",
    ),
  );
}

function sameStringSet(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function safeSessionSegment(input: string): string {
  return String(input || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_");
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

function isValidRequestForKind(
  request: AgentActionRequestSnapshot | undefined,
  kind: AgentActionKind,
): boolean {
  if (!request) return false;
  if (kind === "paper.rating.set") {
    return Boolean(
      request.paper &&
      request.paper.itemId === request.itemId &&
      request.paper.itemKey === request.itemKey &&
      Number.isInteger(request.rating) &&
      Number(request.rating) >= 1 &&
      Number(request.rating) <= 5,
    );
  }
  if (kind === "paper.depth.set") {
    return Boolean(
      request.paper &&
      request.paper.itemId === request.itemId &&
      request.paper.itemKey === request.itemKey &&
      (request.targetTier === "L0" ||
        request.targetTier === "L1" ||
        request.targetTier === "L2"),
    );
  }
  return true;
}
