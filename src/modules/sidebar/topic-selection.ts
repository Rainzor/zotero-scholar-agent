/**
 * Holds the state for creating a Topic Note from a set of papers: which papers
 * are selected, and whether the UI is currently in "selection mode". Pure — no
 * DOM. The sidebar owns a single instance; the navigator reads it to decide
 * whether to render checkboxes, and the sticky action bar reads it for counts.
 */
export class TopicSelectionController {
  private readonly selected = new Set<string>();
  private active = false;

  /** Enter selection mode (checkboxes appear, sticky bar shows). */
  enter(): void {
    this.active = true;
  }

  /** Leave selection mode and clear the current selection. */
  cancel(): void {
    this.active = false;
    this.selected.clear();
  }

  /** Clear the selection without leaving selection mode. */
  clear(): void {
    this.selected.clear();
  }

  toggle(key: string, checked: boolean): void {
    if (checked) this.selected.add(key);
    else this.selected.delete(key);
  }

  has(key: string): boolean {
    return this.selected.has(key);
  }

  size(): number {
    return this.selected.size;
  }

  isActive(): boolean {
    return this.active;
  }

  /** A Topic Note needs at least two papers to be meaningful. */
  canCreate(): boolean {
    return this.selected.size >= 2;
  }

  keys(): string[] {
    return Array.from(this.selected);
  }
}
