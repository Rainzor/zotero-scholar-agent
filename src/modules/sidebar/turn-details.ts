import type { ChatMessage } from "../../addon";

export type TurnDetailKind =
  | "reasoning"
  | "activity"
  | "quality"
  | "relationships";

export type TurnDetailSection = {
  kind: TurnDetailKind;
  label: string;
  status?: "passed" | "needs-review" | "failed";
};

export type TurnDetailsViewModel = {
  summary: string;
  sections: TurnDetailSection[];
  chipTargets: Partial<Record<"quality" | "relationships", TurnDetailKind>>;
};

export function buildTurnDetailsViewModel(
  message: Pick<
    ChatMessage,
    "reasoning" | "activities" | "quality" | "relationshipUpdates"
  >,
): TurnDetailsViewModel {
  const sections: TurnDetailSection[] = [];
  const chipTargets: TurnDetailsViewModel["chipTargets"] = {};
  const summaryParts: string[] = [];

  if (message.reasoning?.trim()) {
    sections.push({ kind: "reasoning", label: "Reasoning" });
  }

  const activityCount = message.activities?.length || 0;
  if (activityCount) {
    sections.push({ kind: "activity", label: "Codex activity" });
    summaryParts.push(`${activityCount} step${activityCount === 1 ? "" : "s"}`);
    if (message.activities?.some((activity) => activity.status === "failed")) {
      summaryParts.push("activity failed");
    } else if (
      message.activities?.some((activity) => activity.status === "in_progress")
    ) {
      summaryParts.push("activity running");
    }
  }

  if (message.quality) {
    sections.push({
      kind: "quality",
      label: "Automated checks",
      status: message.quality.status,
    });
    chipTargets.quality = "quality";
    summaryParts.push(qualitySummary(message.quality));
  }

  const relationshipCount = message.relationshipUpdates?.length || 0;
  if (relationshipCount) {
    sections.push({ kind: "relationships", label: "Relationships" });
    chipTargets.relationships = "relationships";
  }

  return {
    summary: ["Run details", ...summaryParts].join(" · "),
    sections,
    chipTargets,
  };
}

function qualitySummary(quality: NonNullable<ChatMessage["quality"]>): string {
  if (quality.status === "passed") return "checks passed";
  if (quality.status === "failed") return "checks failed";
  return "checks need review";
}
