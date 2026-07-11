import type { ChatMessage, CodexActivity } from "../../addon";
import type { SemanticRelationship } from "../../services/codex";
import { formatActivityLabel } from "../../services/research-turn/activity-label";
import { buildTurnDetailsViewModel, type TurnDetailKind } from "./turn-details";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

export type TurnDetailsRenderOptions = {
  enhancePageEvidence: (root: HTMLElement) => void;
};

export function buildTurnDetailsBlock(
  doc: Document,
  message: ChatMessage,
  options: TurnDetailsRenderOptions,
): HTMLElement | null {
  const model = buildTurnDetailsViewModel(message);
  if (!model.sections.length) return null;

  const details = doc.createElementNS(XHTML_NS, "details") as HTMLElement;
  details.className = "zoteroagent-turn-details";
  const summary = doc.createElementNS(XHTML_NS, "summary") as HTMLElement;
  summary.className = "zoteroagent-turn-details-summary";
  summary.textContent = model.summary;
  details.appendChild(summary);

  for (const section of model.sections) {
    const sectionEl = doc.createElementNS(XHTML_NS, "section") as HTMLElement;
    sectionEl.className = `zoteroagent-turn-detail-section is-${section.kind}${
      section.status ? ` is-${section.status}` : ""
    }`;
    sectionEl.dataset.turnDetailSection = section.kind;
    sectionEl.tabIndex = -1;

    const heading = doc.createElementNS(XHTML_NS, "h3") as HTMLElement;
    heading.className = "zoteroagent-turn-detail-heading";
    heading.textContent = section.label;
    sectionEl.appendChild(heading);

    if (section.kind === "reasoning") {
      const content = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
      content.className = "zoteroagent-thinking-content";
      content.textContent = message.reasoning || "";
      sectionEl.appendChild(content);
    }
    if (section.kind === "activity") {
      sectionEl.appendChild(
        buildActivityContent(doc, message.activities || []),
      );
    }
    if (section.kind === "quality" && message.quality) {
      sectionEl.appendChild(buildQualityReviewContent(doc, message.quality));
    }
    if (section.kind === "relationships") {
      sectionEl.appendChild(
        buildRelationshipReviewContent(
          doc,
          message.relationshipUpdates || [],
          options.enhancePageEvidence,
        ),
      );
    }
    details.appendChild(sectionEl);
  }
  return details;
}

export function buildTurnFooter(
  doc: Document,
  message: ChatMessage,
  onOpenDetail: (kind: TurnDetailKind) => void,
): HTMLElement {
  const footer = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  footer.className = "zoteroagent-turn-footer";
  const details = buildTurnDetailsViewModel(message);

  if (message.contextPapers?.length) {
    const chip = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    chip.className = "zoteroagent-turn-chip is-context";
    chip.textContent = `Used ${message.contextPapers.length} @ paper${
      message.contextPapers.length === 1 ? "" : "s"
    }`;
    footer.appendChild(chip);
  }
  if (message.relationshipUpdates?.length) {
    footer.appendChild(
      createTurnDetailChip(
        doc,
        `${message.relationshipUpdates.length} relationship${
          message.relationshipUpdates.length === 1 ? "" : "s"
        }`,
        "is-relationship",
        details.chipTargets.relationships || "relationships",
        onOpenDetail,
      ),
    );
  }
  if (message.memoryUpdated) {
    const chip = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    chip.className = "zoteroagent-turn-chip is-memory";
    chip.textContent = "Memory updated";
    footer.appendChild(chip);
  }
  if (message.quality) {
    footer.appendChild(
      createTurnDetailChip(
        doc,
        message.quality.status === "passed"
          ? "Checks passed"
          : message.quality.status === "failed"
            ? "Checks failed"
            : "Checks need review",
        `is-quality is-${message.quality.status}`,
        details.chipTargets.quality || "quality",
        onOpenDetail,
      ),
    );
  }
  if (message.committed) {
    const chip = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    chip.className = "zoteroagent-turn-chip is-commit";
    chip.textContent = "Saved to vault";
    footer.appendChild(chip);
  }
  return footer;
}

export function openTurnDetail(main: HTMLElement, kind: TurnDetailKind): void {
  const details = main.querySelector(
    ".zoteroagent-turn-details",
  ) as HTMLDetailsElement | null;
  const section = main.querySelector(
    `[data-turn-detail-section="${kind}"]`,
  ) as HTMLElement | null;
  if (!details || !section) return;
  details.open = true;
  section.focus({ preventScroll: true });
  section.scrollIntoView({ block: "nearest" });
}

function buildActivityContent(
  doc: Document,
  activities: CodexActivity[],
): HTMLElement {
  const list = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  list.className = "zoteroagent-activity-list";
  for (const activity of activities) {
    const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    row.className = "zoteroagent-activity-row";
    const status = String(activity.status || "").toLowerCase();
    const badge = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    badge.className = `zoteroagent-activity-badge ${
      status === "failed"
        ? "is-failed"
        : status === "in_progress"
          ? "is-running"
          : "is-ok"
    }`;
    badge.textContent =
      status === "failed" ? "fail" : status === "in_progress" ? "run" : "ok";
    const command = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    command.className = "zoteroagent-activity-label";
    command.textContent = formatActivityLabel(activity.command || "command");
    command.title = activity.command || "command";
    row.appendChild(badge);
    row.appendChild(command);
    list.appendChild(row);
  }
  return list;
}

function buildRelationshipReviewContent(
  doc: Document,
  relationships: SemanticRelationship[],
  enhancePageEvidence: (root: HTMLElement) => void,
): HTMLElement {
  const list = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  list.className = "zoteroagent-relationship-review-list";
  for (const relationship of relationships) {
    const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    row.className = "zoteroagent-relationship-review-row";
    const type = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    type.className = "zoteroagent-relationship-type";
    type.textContent = relationship.type;
    const text = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    text.className = "zoteroagent-relationship-text";
    text.textContent = `${relationship.targetItemKey}: ${relationship.rationale}${
      relationship.evidence ? ` Evidence: ${relationship.evidence}` : ""
    }`;
    enhancePageEvidence(text);
    row.appendChild(type);
    row.appendChild(text);
    list.appendChild(row);
  }
  return list;
}

function buildQualityReviewContent(
  doc: Document,
  quality: NonNullable<ChatMessage["quality"]>,
): HTMLElement {
  const list = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  list.className = "zoteroagent-quality-review-list";
  for (const message of [...quality.hardFailures, ...quality.warnings]) {
    const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    row.className = "zoteroagent-quality-review-row";
    row.textContent = message;
    list.appendChild(row);
  }
  if (!list.childNodes.length) {
    const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    row.className = "zoteroagent-quality-review-row";
    row.textContent = "All deterministic Knowledge Surface checks passed.";
    list.appendChild(row);
  }
  return list;
}

function createTurnDetailChip(
  doc: Document,
  label: string,
  className: string,
  detail: TurnDetailKind,
  onOpenDetail: (kind: TurnDetailKind) => void,
): HTMLButtonElement {
  const chip = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  chip.type = "button";
  chip.className = `zoteroagent-turn-chip ${className}`;
  chip.textContent = label;
  chip.setAttribute("aria-label", `Show ${label.toLowerCase()} details`);
  chip.addEventListener("click", () => onOpenDetail(detail));
  return chip;
}
