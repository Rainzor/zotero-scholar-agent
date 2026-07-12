import { describe, expect, it } from "vitest";
import {
  buildTopicNoteMarkdown,
  buildTopicNotePrompt,
  createOrUpdateTopicNote,
  normalizeTopicSlug,
  parseTopicNote,
} from "../src/services/topic-notes";

describe("Topic Notes", () => {
  it("normalizes a stable topic slug", () => {
    expect(normalizeTopicSlug("Video World Models 2026")).toBe(
      "video-world-models-2026",
    );
    expect(normalizeTopicSlug("  中文 Topic  ")).toMatch(/^topic-[a-f0-9]{8}$/);
  });

  it("builds and parses plugin-owned topic metadata", () => {
    const markdown = buildTopicNoteMarkdown({
      title: "Video World Models",
      slug: "video-world-models",
      paperItemKeys: ["AAAA1111", "BBBB2222", "AAAA1111"],
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
    const parsed = parseTopicNote(markdown);

    expect(parsed.meta).toEqual({
      topicVersion: 1,
      title: "Video World Models",
      slug: "video-world-models",
      paperItemKeys: ["AAAA1111", "BBBB2222"],
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
    expect(parsed.body).toContain("## Method Lineage");
    expect(parsed.body).toContain("## Open Questions");
    expect(parsed.body).toContain("## Researcher Judgment (Draft)");
  });

  it("builds an explicit-selection prompt without allowing paper rewrites", () => {
    const prompt = buildTopicNotePrompt({
      title: "Video World Models",
      slug: "video-world-models",
      paperItemKeys: ["AAAA1111", "BBBB2222"],
    });

    expect(prompt).toContain("AAAA1111/memory.md");
    expect(prompt).toContain("BBBB2222/record.json");
    expect(prompt).toContain("topics/video-world-models.md");
    expect(prompt).toContain("Do not modify any paper directory");
  });

  it("removes a new Topic Note skeleton when Codex fails", async () => {
    const files = new Map<string, string>();
    await expect(
      createOrUpdateTopicNote(
        {
          title: "Video World Models",
          paperItemKeys: ["AAAA1111", "BBBB2222"],
        },
        {
          getVaultDir: async () => "/vault",
          ensureDirectory: async () => undefined,
          readText: async (path) => files.get(path) || "",
          writeText: async (path, value) => {
            files.set(path, value);
          },
          removeText: async (path) => {
            files.delete(path);
          },
          runCodexTurn: async () => {
            throw new Error("Codex failed");
          },
          commitVaultChanges: async () => false,
        },
      ),
    ).rejects.toThrow("Codex failed");

    expect(files.size).toBe(0);
  });
});
