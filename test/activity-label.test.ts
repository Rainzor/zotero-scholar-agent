import { describe, expect, it } from "vitest";
import { formatActivityLabel } from "../src/services/research-turn/activity-label";

describe("formatActivityLabel", () => {
  it("describes common paper-reading commands", () => {
    expect(
      formatActivityLabel(
        "/bin/zsh -lc \"sed -n '120,280p' 2HMS9JJX/text.txt\"",
      ),
    ).toBe("Read text.txt (lines 120–280)");
    expect(
      formatActivityLabel("rg -n -i 'evaluation keywords' 2HMS9JJX/text.txt"),
    ).toBe('Search text.txt for "evaluation keywords"');
    expect(formatActivityLabel("cat 2HMS9JJX/memory.md")).toBe(
      "Read memory.md",
    );
    expect(formatActivityLabel("ls 2HMS9JJX/figures")).toBe(
      "List files in figures",
    );
  });

  it("describes git checks and safely falls back for unknown commands", () => {
    expect(formatActivityLabel("git status --short")).toBe("Check git status");
    expect(formatActivityLabel("git diff -- 2HMS9JJX/memory.md")).toBe(
      "Review git changes",
    );
    expect(
      formatActivityLabel(
        "python very-long-custom-script.py --with-many --unfamiliar --arguments",
      ),
    ).toBe(
      "Run command: python very-long-custom-script.py --with-many --unfamiliar --arguments",
    );
  });

  it("makes every step in an 11-step research run readable", () => {
    const labels = [
      "sed -n '1,80p' PAPER/text.txt",
      "sed -n '81,160p' PAPER/text.txt",
      "rg -n 'evaluation' PAPER/text.txt",
      "cat PAPER/memory.md",
      "ls PAPER",
      "git status --short",
      "git diff -- PAPER/memory.md",
      "git log -1 --oneline",
      "sed -n '160,240p' PAPER/text.txt",
      "rg -n 'limitation' PAPER/text.txt",
      "python check_quality.py PAPER/memory.md",
    ].map(formatActivityLabel);

    expect(labels).toEqual([
      "Read text.txt (lines 1–80)",
      "Read text.txt (lines 81–160)",
      'Search text.txt for "evaluation"',
      "Read memory.md",
      "List files in PAPER",
      "Check git status",
      "Review git changes",
      "Run git command",
      "Read text.txt (lines 160–240)",
      'Search text.txt for "limitation"',
      "Run command: python check_quality.py PAPER/memory.md",
    ]);
  });
});
