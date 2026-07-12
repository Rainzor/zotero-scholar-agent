import {
  getConfiguredCodexCheapModelSlug,
  getConfiguredColdStartReasoningEffort,
} from "./codex";
import { runPaperColdStart } from "./cold-start";
import type { PaperVaultMeta, RunningLineProcess } from "./codex";

export type ColdStartJobStatus =
  | "pending"
  | "running"
  | "passed"
  | "needs-review"
  | "failed"
  | "cancelled";

export type ColdStartJobInput = {
  paper: PaperVaultMeta;
  pdfItemId: number;
};

export type ColdStartJob = ColdStartJobInput & {
  status: ColdStartJobStatus;
  error: string;
  createdAt: number;
  updatedAt: number;
};

export type ColdStartQueueState = {
  version: 1;
  jobs: ColdStartJob[];
};

type ColdStartQueueDeps = {
  load: () => Promise<ColdStartQueueState | null>;
  save: (state: ColdStartQueueState) => Promise<void>;
  execute: (
    job: ColdStartJob,
    controls: { setProcess: (process: RunningLineProcess) => void },
  ) => Promise<{ qualityStatus: "passed" | "needs-review" | "failed" }>;
  now?: () => number;
};

export class ColdStartQueue {
  private state: ColdStartQueueState = { version: 1, jobs: [] };
  private running = false;
  private cancelRequested = false;
  private pauseRequested = false;
  private currentProcess: RunningLineProcess | null = null;
  private readonly listeners = new Set<(state: ColdStartQueueState) => void>();

  constructor(private readonly deps: ColdStartQueueDeps) {}

  async init() {
    const loaded = await this.deps.load();
    this.state = normalizeQueueState(loaded);
    await this.persist();
  }

  getState(): ColdStartQueueState {
    return cloneState(this.state);
  }

  hasActiveJobs(): boolean {
    return this.state.jobs.some(
      (job) => job.status === "pending" || job.status === "running",
    );
  }

  subscribe(listener: (state: ColdStartQueueState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async enqueue(inputs: ColdStartJobInput[]) {
    const now = this.now();
    for (const input of inputs) {
      const existing = this.state.jobs.find(
        (job) => job.paper.itemKey === input.paper.itemKey,
      );
      if (existing) {
        if (existing.status !== "pending" && existing.status !== "running") {
          existing.paper = input.paper;
          existing.pdfItemId = input.pdfItemId;
          existing.status = "pending";
          existing.error = "";
          existing.updatedAt = now;
        }
        continue;
      }
      this.state.jobs.push({
        ...input,
        status: "pending",
        error: "",
        createdAt: now,
        updatedAt: now,
      });
    }
    await this.persist();
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.cancelRequested = false;
    this.pauseRequested = false;
    try {
      for (const job of this.state.jobs) {
        if (this.cancelRequested || this.pauseRequested) break;
        if (job.status !== "pending") continue;
        job.status = "running";
        job.error = "";
        job.updatedAt = this.now();
        await this.persist();
        try {
          const result = await this.deps.execute(job, {
            setProcess: (process) => {
              this.currentProcess = process;
            },
          });
          job.status =
            result.qualityStatus === "failed" ? "failed" : result.qualityStatus;
          job.error =
            result.qualityStatus === "failed"
              ? "Knowledge quality gate failed."
              : "";
        } catch (error) {
          job.status = this.pauseRequested
            ? "pending"
            : this.cancelRequested
              ? "cancelled"
              : "failed";
          job.error =
            this.pauseRequested || this.cancelRequested
              ? ""
              : error instanceof Error
                ? error.message
                : String(error);
        } finally {
          this.currentProcess = null;
          job.updatedAt = this.now();
          await this.persist();
        }
      }
    } finally {
      this.running = false;
    }
  }

  async cancel() {
    this.cancelRequested = true;
    try {
      this.currentProcess?.kill();
    } catch {
      // Process may already have exited.
    }
    for (const job of this.state.jobs) {
      if (job.status === "pending") {
        job.status = "cancelled";
        job.updatedAt = this.now();
      }
    }
    await this.persist();
  }

  async pause() {
    this.pauseRequested = true;
    try {
      this.currentProcess?.kill();
    } catch {
      // Process may already have exited.
    }
    await this.persist();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async persist() {
    await this.deps.save(this.getState());
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export const coldStartQueue = new ColdStartQueue({
  load: loadQueueState,
  save: saveQueueState,
  execute: async (job, controls) => {
    const cheapModel = getConfiguredCodexCheapModelSlug();
    const result = await runPaperColdStart(
      {
        paper: job.paper,
        pdfItemId: job.pdfItemId,
        model: cheapModel || undefined,
        reasoningEffort: getConfiguredColdStartReasoningEffort(),
        linkRelationships: true,
      },
      {
        onProcess: controls.setProcess,
      },
    );
    return { qualityStatus: result.quality.status };
  },
});

function normalizeQueueState(value: unknown): ColdStartQueueState {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<ColdStartQueueState>)
      : {};
  const jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
  return {
    version: 1,
    jobs: jobs
      .filter((job): job is ColdStartJob => Boolean(job?.paper?.itemKey))
      .map((job) => ({
        ...job,
        status: job.status === "running" ? "pending" : job.status,
        error: String(job.error || ""),
      })),
  };
}

function cloneState(state: ColdStartQueueState): ColdStartQueueState {
  return {
    version: 1,
    jobs: state.jobs.map((job) => ({
      ...job,
      paper: {
        ...job.paper,
        zoteroCollections: job.paper.zoteroCollections?.map((entry) => ({
          ...entry,
        })),
        zoteroTags: job.paper.zoteroTags?.slice(),
        paperKeywords: job.paper.paperKeywords?.slice(),
      },
    })),
  };
}

async function loadQueueState(): Promise<ColdStartQueueState | null> {
  try {
    const path = getQueuePath();
    if (!(await (globalThis as any).IOUtils.exists(path))) return null;
    return JSON.parse(await (globalThis as any).IOUtils.readUTF8(path));
  } catch {
    return null;
  }
}

async function saveQueueState(state: ColdStartQueueState): Promise<void> {
  const ioUtils = (globalThis as any).IOUtils;
  if (!ioUtils) return;
  const pathUtils = (globalThis as any).PathUtils;
  const dir = pathUtils?.join
    ? pathUtils.join(Zotero.DataDirectory.dir, "zoteroagent")
    : `${Zotero.DataDirectory.dir}/zoteroagent`;
  await ioUtils.makeDirectory(dir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await ioUtils.writeUTF8(
    getQueuePath(),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

function getQueuePath(): string {
  const pathUtils = (globalThis as any).PathUtils;
  return pathUtils?.join
    ? pathUtils.join(
        Zotero.DataDirectory.dir,
        "zoteroagent",
        "cold-start-queue.json",
      )
    : `${Zotero.DataDirectory.dir}/zoteroagent/cold-start-queue.json`;
}
