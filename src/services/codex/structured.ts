import { runCodexTurn, buildCodexArgs } from "./runner";
import { getVaultDir } from "./vault";
import type { CodexReasoningEffort } from "./context-window";
import type { RunningLineProcess } from "./subprocess";
import { isAgentMessageItem, type CodexEvent } from "./events";

export type JsonSchema = Record<string, unknown>;

export type StructuredCodexTurnInput<T> = {
  prompt: string;
  schema: JsonSchema;
  schemaName?: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  webSearch?: boolean;
  ephemeral?: boolean;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  validate: (value: unknown) => T;
  onStatus?: (text: string) => void;
  onProcess?: (process: RunningLineProcess) => void;
};

export async function runStructuredCodexTurn<T>(
  input: StructuredCodexTurnInput<T>,
): Promise<T> {
  const vaultDir = await getVaultDir();
  const schemaDir = joinPath(vaultDir, ".generated", "schemas");
  const schemaPath = joinPath(
    schemaDir,
    `${safeSegment(input.schemaName || `action-${Date.now()}`)}.json`,
  );
  const ioUtils = getIOUtils();
  await ioUtils.makeDirectory(schemaDir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await ioUtils.writeUTF8(
    schemaPath,
    `${JSON.stringify(input.schema, null, 2)}\n`,
  );
  let finalMessage = "";
  try {
    const result = await runCodexTurn({
      prompt: input.prompt,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      sandbox: input.sandbox,
      webSearch: input.webSearch,
      ephemeral: input.ephemeral,
      outputSchemaPath: schemaPath,
      fallbackToDefaultModel: false,
      onStatus: input.onStatus,
      onProcess: input.onProcess,
      onEvent: (event) => {
        finalMessage = captureStructuredFinalMessage(finalMessage, event);
      },
    });
    return input.validate(
      parseStructuredCodexContent(finalMessage || result.content),
    );
  } finally {
    try {
      await ioUtils.remove(schemaPath, { ignoreAbsent: true });
    } catch {
      // Temporary schemas are gitignored and safe to leave for later cleanup.
    }
  }
}

export function captureStructuredFinalMessage(
  current: string,
  event: CodexEvent,
): string {
  if (event.type !== "item.completed" || !isAgentMessageItem(event.item)) {
    return current;
  }
  return String(event.item.text || "").trim() || current;
}

export function buildStructuredCodexArgs(options: {
  vaultDir: string;
  prompt: string;
  schemaPath: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  webSearch?: boolean;
  ephemeral?: boolean;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
}): string[] {
  return buildCodexArgs({
    vaultDir: options.vaultDir,
    prompt: options.prompt,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    sandbox: options.sandbox,
    webSearch: options.webSearch,
    ephemeral: options.ephemeral,
    outputSchemaPath: options.schemaPath,
  });
}

export function parseStructuredCodexContent(content: string): unknown {
  const trimmed = String(content || "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = String(fenced?.[1] || trimmed).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error("Codex did not return valid JSON for this action.");
  }
}

function safeSegment(value: string): string {
  return String(value || "action")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function joinPath(...parts: string[]): string {
  const pathUtils = (globalThis as any).PathUtils;
  if (pathUtils?.join) return pathUtils.join(...parts.filter(Boolean));
  return parts
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.replace(/\/+$/g, "") : part.replace(/^\/+|\/+$/g, ""),
    )
    .join("/");
}

function getIOUtils(): any {
  const ioUtils = (globalThis as any).IOUtils;
  if (!ioUtils) throw new Error("IOUtils is unavailable.");
  return ioUtils;
}
