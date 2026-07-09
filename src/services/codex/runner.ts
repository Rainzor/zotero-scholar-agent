import {
  applyCodexEvent,
  createCodexStreamState,
  parseCodexEventLine,
  type CodexEvent,
  type CodexStreamState,
} from "./events";
import {
  enrichUsageWithContext,
  resolveCodexModelForExecution,
  resolveCodexContextWindow,
} from "./context-window";
import { resolveCodexBinary } from "./path";
import { spawnLineProcess, type RunningLineProcess } from "./subprocess";
import { getVaultDir } from "./vault";

export type CodexTurnInput = {
  prompt: string;
  threadId?: string;
  model?: string;
  fallbackToDefaultModel?: boolean;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  timeoutMs?: number;
  onStatus?: (text: string) => void;
  onChunk?: (state: {
    content: string;
    reasoning: string;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      reasoningTokens?: number;
      cachedInputTokens?: number;
      contextWindowTokens?: number;
      effectiveContextWindowTokens?: number;
      contextUsedPercent?: number;
    };
  }) => void;
  onEvent?: (event: CodexEvent) => void;
  onProcess?: (process: RunningLineProcess) => void;
};

export type CodexTurnResult = {
  content: string;
  reasoning: string;
  threadId: string;
  usage?: CodexStreamState["usage"];
  modelSlug?: string;
};

const DEFAULT_CODEX_TIMEOUT_MS = 600000;

export async function runCodexTurn(
  input: CodexTurnInput,
): Promise<CodexTurnResult> {
  const vaultDir = await getVaultDir();
  const codex = await resolveCodexBinary();
  const requestedModel = String(input.model || "").trim();
  const modelResolution = await resolveCodexModelForExecution(
    requestedModel,
    codex.path,
  );
  if (
    requestedModel &&
    modelResolution.checkedCatalog &&
    !modelResolution.modelSlug
  ) {
    input.onStatus?.(
      `Configured Codex model "${requestedModel}" is unavailable. Falling back to default Codex model.`,
    );
  }
  const primaryModel = modelResolution.modelSlug || "";
  input.onStatus?.(
    input.threadId ? "Resuming Codex session..." : "Starting Codex...",
  );

  let execution = await executeCodexProcess({
    input,
    codexPath: codex.path,
    vaultDir,
    model: primaryModel,
  });
  if (
    primaryModel &&
    input.fallbackToDefaultModel !== false &&
    execution.result.exitCode !== 0 &&
    !execution.result.timedOut &&
    !execution.state.content
  ) {
    input.onStatus?.(
      `Codex model "${primaryModel}" failed. Retrying with default Codex model...`,
    );
    execution = await executeCodexProcess({
      input,
      codexPath: codex.path,
      vaultDir,
      model: "",
    });
  }

  const { result, state, model } = execution;
  if (result.timedOut) {
    throw new Error(
      `Codex timed out after ${input.timeoutMs || DEFAULT_CODEX_TIMEOUT_MS}ms.`,
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr ||
        result.stdout ||
        `Codex exited with code ${result.exitCode}`,
    );
  }
  const contextWindow = await resolveCodexContextWindow({
    codexPath: codex.path,
    modelSlug: model || undefined,
  });
  state.usage = enrichUsageWithContext(state.usage, contextWindow);
  return {
    content: state.content,
    reasoning: state.reasoning,
    threadId: state.threadId || input.threadId || "",
    usage: state.usage,
    modelSlug: model || undefined,
  };
}

async function executeCodexProcess(options: {
  input: CodexTurnInput;
  codexPath: string;
  vaultDir: string;
  model: string;
}): Promise<{
  state: CodexStreamState;
  result: Awaited<ReturnType<RunningLineProcess["wait"]>>;
  model: string;
}> {
  const { input, codexPath, vaultDir, model } = options;
  const state = createCodexStreamState();
  const args = buildCodexArgs({
    vaultDir,
    prompt: input.prompt,
    threadId: input.threadId,
    model,
    sandbox: input.sandbox || "workspace-write",
  });
  let lastContent = "";
  const proc = await spawnLineProcess({
    command: codexPath,
    arguments: args,
    cwd: vaultDir,
    timeoutMs: input.timeoutMs || DEFAULT_CODEX_TIMEOUT_MS,
    onStdoutLine: (line) => {
      const event = parseCodexEventLine(line);
      if (!event) return;
      input.onEvent?.(event);
      applyCodexEvent(state, event);
      if (state.latestStatus) input.onStatus?.(state.latestStatus);
      if (state.content !== lastContent || state.usage) {
        lastContent = state.content;
        input.onChunk?.({
          content: state.content,
          reasoning: state.reasoning,
          usage: state.usage
            ? {
                promptTokens: state.usage.promptTokens,
                completionTokens: state.usage.completionTokens,
                totalTokens: state.usage.totalTokens,
                reasoningTokens: state.usage.reasoningTokens,
                cachedInputTokens: state.usage.cachedInputTokens,
                contextWindowTokens: state.usage.contextWindowTokens,
                effectiveContextWindowTokens:
                  state.usage.effectiveContextWindowTokens,
                contextUsedPercent: state.usage.contextUsedPercent,
              }
            : undefined,
        });
      }
    },
    onStderrLine: (line) => {
      if (!line.trim()) return;
      ztoolkit.log("[Codex stderr]", line);
    },
  });
  input.onProcess?.(proc);
  const result = await proc.wait();
  return { state, result, model };
}

function buildCodexArgs(options: {
  vaultDir: string;
  prompt: string;
  threadId?: string;
  model?: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
}): string[] {
  const base = [
    "exec",
    "--json",
    ...(options.model ? ["--model", options.model] : []),
    "-C",
    options.vaultDir,
    "-s",
    options.sandbox,
  ];
  if (options.threadId) {
    return [...base, "resume", options.threadId, options.prompt];
  }
  return [...base, options.prompt];
}
