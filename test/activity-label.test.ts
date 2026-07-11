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
    ).toBe("Run command: python very-long-custom-script.py --with-many --unfamiliar --arguments");
  });
});
