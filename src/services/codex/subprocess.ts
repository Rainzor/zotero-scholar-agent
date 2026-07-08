type LineHandler = (line: string) => void;

export type LineProcessOptions = {
  command: string;
  arguments?: string[];
  cwd?: string;
  environment?: Record<string, string>;
  timeoutMs?: number;
  onStdoutLine?: LineHandler;
  onStderrLine?: LineHandler;
  onExit?: (exitCode: number) => void;
};

export type LineProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

export type RunningLineProcess = {
  wait: () => Promise<LineProcessResult>;
  kill: () => void;
};

type SubprocessModule = {
  call?: (options: {
    command: string;
    arguments?: string[];
    environment?: Record<string, string>;
    workdir?: string;
  }) => Promise<any>;
};

const DEFAULT_TIMEOUT_MS = 300000;

export async function runLineProcess(
  options: LineProcessOptions,
): Promise<LineProcessResult> {
  const proc = await spawnLineProcess(options);
  return proc.wait();
}

export async function spawnLineProcess(
  options: LineProcessOptions,
): Promise<RunningLineProcess> {
  const Subprocess = importSubprocess();
  if (!Subprocess?.call) {
    throw new Error("Mozilla Subprocess.call is not available in this Zotero environment.");
  }

  const proc = await Subprocess.call({
    command: options.command,
    arguments: options.arguments || [],
    environment: buildProcessEnvironment(options.command, options.environment),
    workdir: options.cwd || undefined,
  });

  closeStdin(proc);

  const stdoutTask = readPipeLines(proc.stdout, options.onStdoutLine);
  const stderrTask = readPipeLines(proc.stderr, options.onStderrLine);

  const waitTask = (async (): Promise<LineProcessResult> => {
    const [stdout, stderr] = await Promise.all([stdoutTask, stderrTask]);
    const waitResult = await proc.wait();
    const exitCode = Number(waitResult?.exitCode ?? proc.exitCode ?? -1);
    options.onExit?.(exitCode);
    return { stdout, stderr, exitCode, timedOut: false };
  })();

  const timeoutMs = Math.max(1, options.timeoutMs || DEFAULT_TIMEOUT_MS);

  return {
    wait: () =>
      new Promise<LineProcessResult>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            proc.kill();
          } catch {
            // The process may already have exited.
          }
          resolve({
            stdout: "",
            stderr: `[Process timed out after ${timeoutMs}ms]`,
            exitCode: -1,
            timedOut: true,
          });
        }, timeoutMs);
        void waitTask.then(
          (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
          },
          (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
              stdout: "",
              stderr: error instanceof Error ? error.message : String(error),
              exitCode: -1,
              timedOut: false,
            });
          },
        );
      }),
    kill: () => {
      try {
        proc.kill();
      } catch {
        // Ignore kill failures; wait() will report the process result if it exits.
      }
    },
  };
}

function importSubprocess(): SubprocessModule {
  const chromeUtils = (globalThis as any).ChromeUtils;
  if (chromeUtils?.importESModule) {
    try {
      const mod = chromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
      return mod.Subprocess || mod.default || mod;
    } catch {
      // Try the legacy JSM below.
    }
  }
  if (chromeUtils?.import) {
    try {
      const mod = chromeUtils.import("resource://gre/modules/Subprocess.jsm");
      return mod.Subprocess || mod.default || mod;
    } catch {
      // Fall through to an empty module.
    }
  }
  return {};
}

function closeStdin(proc: any) {
  // Phase 0 found that `codex exec` hangs forever if stdin is a non-TTY pipe
  // left open ("Reading additional input from stdin..."). Close it immediately
  // for every spawned process; callers can add explicit stdin support later.
  try {
    proc?.stdin?.close?.();
  } catch {
    // Some Subprocess implementations do not expose stdin; that's fine.
  }
}

function buildProcessEnvironment(
  command: string,
  overrides?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "CODEX_HOME",
    "OPENAI_API_KEY",
  ]) {
    const value = getEnv(key);
    if (value) env[key] = value;
  }

  const commandDir = dirname(command);
  const existingPath = getEnv("PATH");
  env.PATH = [
    commandDir,
    existingPath,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ]
    .filter(Boolean)
    .join(":");

  if (!env.HOME) {
    const home = getHomeDir();
    if (home) env.HOME = home;
  }

  return { ...env, ...(overrides || {}) };
}

function getEnv(key: string): string {
  try {
    return String((globalThis as any).Services?.env?.get?.(key) || "");
  } catch {
    return "";
  }
}

function getHomeDir(): string {
  try {
    const dirsvc = (globalThis as any).Services?.dirsvc;
    const components = (globalThis as any).Components;
    const home = dirsvc?.get?.("Home", components?.interfaces?.nsIFile);
    if (home?.path) return String(home.path);
  } catch {
    // Ignore.
  }
  return "";
}

function dirname(path: string): string {
  const normalized = String(path || "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

async function readPipeLines(
  pipe: any,
  onLine?: LineHandler,
): Promise<string> {
  if (!pipe?.readString) return "";
  let buffer = "";
  let all = "";
  try {
    while (true) {
      const chunk = await pipe.readString();
      if (!chunk) break;
      all += chunk;
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        onLine?.(line);
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } catch {
    // Pipe closed by process exit or kill.
  }
  if (buffer) onLine?.(buffer.replace(/\r$/, ""));
  return all;
}
