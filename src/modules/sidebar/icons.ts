export type IconName =
  | "copy"
  | "delete"
  | "new"
  | "rename"
  | "clear"
  | "check"
  | "error"
  | "history"
  | "attach"
  | "attachPdf"
  | "edit"
  | "image"
  | "send"
  | "more"
  | "refresh";

export function getIconSvg(icon: IconName): string {
  switch (icon) {
    case "attach":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.2 10.9l4.7-4.7a2.5 2.5 0 113.5 3.5l-5.8 5.8a4 4 0 11-5.7-5.7l5.8-5.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "attachPdf":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 2.8h6.5l3.5 3.6v10.8a1.8 1.8 0 01-1.8 1.8H6a1.8 1.8 0 01-1.8-1.8V4.6A1.8 1.8 0 016 2.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12.5 2.9V6.4h3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7.1 11.6h5.8M7.1 14.3h4.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    case "history":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v4.5l3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "edit":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M13.6 3.6a2.1 2.1 0 013 3L7.3 15.8l-4 1 1-4L13.6 3.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "send":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10h13M10.5 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "image":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7" cy="8" r="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.5 14l3.5-3.5 2.4 2.2 2.2-2.2 3 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "copy":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="4" width="9" height="11" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="7" width="9" height="11" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    case "delete":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 6v-1.1c0-.9.7-1.6 1.6-1.6h1.8c.9 0 1.6.7 1.6 1.6V6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 6l.7 9.2c.1.8.7 1.5 1.5 1.5h2.6c.8 0 1.5-.7 1.5-1.5l.7-9.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 8.4v5.8M11 8.4v5.8" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    case "new":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case "rename":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 13.6l-.4 2.8 2.8-.4 7.8-7.8-2.4-2.4-7.8 7.8z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.9 5.5l2.4 2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.8 16.4h12.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    case "clear":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.2 5.2l9.6 9.6M14.8 5.2l-9.6 9.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case "check":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.4 3.4 7.6-7.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "error":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
    case "more":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.2" fill="currentColor"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/><circle cx="15.5" cy="10" r="1.2" fill="currentColor"/></svg>`;
    case "refresh":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M16.2 8.3A6.5 6.5 0 105 15.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16.2 4.2v4.4h-4.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    default:
      return "";
  }
}

export function setIconButton(
  button: HTMLButtonElement,
  icon: IconName,
  label: string,
): void {
  button.classList.add("zoteroagent-icon-button");
  button.setAttribute("aria-label", label);
  button.title = label;
  insertSvgMarkup(button, getIconSvg(icon));
}

export function insertSvgMarkup(element: HTMLElement, svgMarkup: string): void {
  while (element.firstChild) element.removeChild(element.firstChild);
  if (!svgMarkup) return;
  try {
    const win = element.ownerDocument.defaultView;
    if (!win) throw new Error("no window");
    const svgDoc = new win.DOMParser().parseFromString(
      svgMarkup,
      "image/svg+xml",
    );
    if (!svgDoc.querySelector("parsererror")) {
      element.appendChild(
        element.ownerDocument.adoptNode(svgDoc.documentElement),
      );
      return;
    }
  } catch {
    // Fall back to an accessible text label when SVG parsing is unavailable.
  }
  element.textContent = element.getAttribute("aria-label")?.charAt(0) || "?";
}
