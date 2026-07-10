import { describe, expect, it } from "vitest";
import {
  ColdStartQueue,
  type ColdStartQueueState,
} from "../src/services/cold-start-queue";

function job(itemKey: string) {
  return {
    paper: {
      itemId: Number(itemKey.slice(-1)) || 1,
      itemKey,
      title: itemKey,
    },
    pdfItemId: Number(itemKey.slice(-1)) || 1,
  };
}

describe("ColdStartQueue", () => {
  it("runs jobs serially and preserves a failed job without blocking later jobs", async () => {
    let active = 0;
    let maxActive = 0;
    const executed: string[] = [];
    let persisted: ColdStartQueueState | null = null;
    const queue = new ColdStartQueue({
      load: async () => persisted,
      save: async (state) => {
        persisted = structuredClone(state);
      },
      execute: async (entry) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        executed.push(entry.paper.itemKey);
        active -= 1;
        if (entry.paper.itemKey === "KEY2") throw new Error("failed");
        return { qualityStatus: "passed" };
      },
    });

    await queue.init();
    await queue.enqueue([job("KEY1"), job("KEY2"), job("KEY3")]);
    await queue.start();

    expect(maxActive).toBe(1);
    expect(executed).toEqual(["KEY1", "KEY2", "KEY3"]);
    expect(queue.getState().jobs.map((entry) => entry.status)).toEqual([
      "passed",
      "failed",
      "passed",
    ]);
  });

  it("recovers persisted running jobs as pending and re-enqueue retries failures", async () => {
    let persisted: ColdStartQueueState | null = {
      version: 1,
      jobs: [
        {
          ...job("KEY1"),
          status: "running",
          error: "",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          ...job("KEY2"),
          status: "failed",
          error: "old failure",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const queue = new ColdStartQueue({
      load: async () => persisted,
      save: async (state) => {
        persisted = structuredClone(state);
      },
      execute: async () => ({ qualityStatus: "passed" }),
    });
    await queue.init();
    expect(queue.getState().jobs[0].status).toBe("pending");
    await queue.enqueue([job("KEY2")]);
    expect(queue.getState().jobs[1]).toMatchObject({
      status: "pending",
      error: "",
    });
  });
});
