import type { CodexActivity } from "../../addon";
import type { CodexEvent } from "../codex";

/**
 * Accumulate Codex command-execution steps from the raw event stream so the
 * turn can show what Codex actually did (grep/cat/apply_patch/git...).
 * Returns true when the activity list changed.
 */
export function collectCodexActivity(
  list: CodexActivity[],
  byId: Map<string, CodexActivity>,
  event: CodexEvent,
): boolean {
  const item = (event as any).item;
  if (!item || item.type !== "command_execution") return false;
  const id = String(item.id || "");
  const command = String(item.command || "").trim();
  if (event.type === "item.started") {
    const entry: CodexActivity = {
      command: command || "command",
      status: "in_progress",
    };
    list.push(entry);
    if (id) byId.set(id, entry);
    return true;
  }
  if (event.type === "item.completed") {
    let entry = id ? byId.get(id) : undefined;
    if (!entry) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].status === "in_progress") {
          entry = list[i];
          break;
        }
      }
    }
    if (!entry) {
      entry = { command: command || "command" };
      list.push(entry);
    }
    const code = item.exit_code;
    entry.exitCode = typeof code === "number" ? code : null;
    entry.status =
      String(item.status || "") ||
      (typeof code === "number" && code !== 0 ? "failed" : "completed");
    if (command) entry.command = command;
    return true;
  }
  return false;
}
