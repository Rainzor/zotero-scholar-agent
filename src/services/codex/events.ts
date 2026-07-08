export type CodexUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
};

export type CodexCommandItem = {
  id?: string;
  type: "command_execution";
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: "in_progress" | "completed" | "failed" | string;
};

export type CodexAgentMessageItem = {
  id?: string;
  type: "agent_message";
  text?: string;
};

export type CodexItem = CodexCommandItem | CodexAgentMessageItem | {
  id?: string;
  type?: string;
  [key: string]: unknown;
};

export type CodexEvent =
  | { type: "thread.started"; thread_id?: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; usage?: CodexUsage }
  | { type: "turn.failed"; error?: unknown }
  | { type: "item.started"; item?: CodexItem }
  | { type: "item.completed"; item?: CodexItem }
  | { type: "error"; message?: string; error?: unknown }
  | { type: string; [key: string]: unknown };

export type CodexStreamState = {
  threadId: string;
  content: string;
  reasoning: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  latestStatus?: string;
};

export function createCodexStreamState(): CodexStreamState {
  return {
    threadId: "",
    content: "",
    reasoning: "",
  };
}

export function parseCodexEventLine(line: string): CodexEvent | null {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as CodexEvent;
  } catch {
    return {
      type: "error",
      message: `Invalid Codex JSONL event: ${trimmed.slice(0, 240)}`,
    };
  }
}

export function applyCodexEvent(
  state: CodexStreamState,
  event: CodexEvent,
): CodexStreamState {
  if (event.type === "thread.started") {
    state.threadId = String(event.thread_id || state.threadId || "");
    state.latestStatus = "Codex session started.";
    return state;
  }

  if (event.type === "turn.started") {
    state.latestStatus = "Codex is thinking...";
    return state;
  }

  if (event.type === "item.started" && isCommandItem(event.item)) {
    state.latestStatus = event.item.command
      ? `Running: ${event.item.command}`
      : "Running command...";
    return state;
  }

  if (event.type === "item.completed" && isCommandItem(event.item)) {
    const code = event.item.exit_code;
    if (typeof code === "number") {
      state.latestStatus =
        code === 0 ? "Command completed." : `Command exited with code ${code}.`;
    } else {
      state.latestStatus = "Command completed.";
    }
    return state;
  }

  if (event.type === "item.completed" && isAgentMessageItem(event.item)) {
    const text = String(event.item.text || "");
    if (text) {
      state.content = appendMessageText(state.content, text);
      state.latestStatus = "Receiving response...";
    }
    return state;
  }

  if (event.type === "turn.completed") {
    state.usage = mapUsage(isUsageLike((event as any).usage) ? (event as any).usage : undefined);
    state.latestStatus = "Codex turn completed.";
    return state;
  }

  if (event.type === "turn.failed" || event.type === "error") {
    const message =
      event.type === "error"
        ? String((event as any).message || (event as any).error || "Codex error")
        : String(event.error || "Codex turn failed");
    state.latestStatus = message;
    if (!state.content) state.content = `[Error] ${message}`;
    return state;
  }

  return state;
}

export function isAgentMessageItem(item: unknown): item is CodexAgentMessageItem {
  return Boolean(item && typeof item === "object" && (item as any).type === "agent_message");
}

export function isCommandItem(item: unknown): item is CodexCommandItem {
  return Boolean(item && typeof item === "object" && (item as any).type === "command_execution");
}

function appendMessageText(existing: string, next: string): string {
  const current = String(existing || "").trimEnd();
  const text = String(next || "").trim();
  if (!current) return text;
  if (!text) return current;
  return `${current}\n\n${text}`;
}

function mapUsage(usage?: CodexUsage): CodexStreamState["usage"] | undefined {
  if (!usage) return undefined;
  const input = Number(usage.input_tokens);
  const cached = Number(usage.cached_input_tokens);
  const output = Number(usage.output_tokens);
  const reasoning = Number(usage.reasoning_output_tokens);
  const promptTokens = Number.isFinite(input) ? input : undefined;
  const completionTokens = Number.isFinite(output) ? output : undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens:
      typeof promptTokens === "number" || typeof completionTokens === "number"
        ? (promptTokens || 0) + (completionTokens || 0)
        : undefined,
    reasoningTokens: Number.isFinite(reasoning) ? reasoning : undefined,
    cachedInputTokens: Number.isFinite(cached) ? cached : undefined,
  };
}

function isUsageLike(value: unknown): value is CodexUsage {
  return Boolean(value && typeof value === "object");
}
