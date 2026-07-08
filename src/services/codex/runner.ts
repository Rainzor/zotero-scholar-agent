import {
  applyCodexEvent,
  createCodexStreamState,
  parseCodexEventLine,
  type CodexEvent,
  type CodexStreamState,
} from "./events";
import { resolveCodexBinary } from "./path";
import { spawnLineProcess, type RunningLineProcess } from "./subprocess";
import { getVaultDir } from "./vault";

export type CodexTurnInput = {
  prompt: string;
  threadId?: string;
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
};

const DEFAULT_CODEX_TIMEOUT_MS = 600000;

export async function runCodexTurn(
  input: CodexTurnInput,
): Promise<CodexTurnResult> {
  const vaultDir = await getVaultDir();
  const codex = await resolveCodexBinary();
  const state = createCodexStreamState();
  const args = buildCodexArgs({
    vaultDir,
    prompt: input.prompt,
    threadId: input.threadId,
    sandbox: input.sandbox || "workspace-write",
  });

  input.onStatus?.(input.threadId ? "Resuming Codex session..." : "Starting Codex...");
  let lastContent = "";
  const proc = await spawnLineProcess({
    command: codex.path,
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
  if (result.timedOut) {
    throw new Error(`Codex timed out after ${input.timeoutMs || DEFAULT_CODEX_TIMEOUT_MS}ms.`);
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `Codex exited with code ${result.exitCode}`);
  }
  return {
    content: state.content,
    reasoning: state.reasoning,
    threadId: state.threadId || input.threadId || "",
    usage: state.usage,
  };
}

function buildCodexArgs(options: {
  vaultDir: string;
  prompt: string;
  threadId?: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
}): string[] {
  const base = [
    "exec",
    "--json",
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
