export type SectionStatusState = "idle" | "saving" | "saved" | "error";

export function setSectionStatus(
  statusEl: HTMLElement,
  state: SectionStatusState,
  message: string,
): void {
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}
