import { getString } from "../../utils/locale";
import { loadServices, getActiveServiceId } from "../../utils/services";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

export function renderServiceList(
  doc: Document,
  container: HTMLElement,
  selectedServiceId: string,
  onSelect: (id: string) => void,
): void {
  while (container.firstChild) container.firstChild.remove();
  const services = loadServices();
  const activeId = getActiveServiceId();

  for (const svc of services) {
    const row = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
    row.className = "zoteroagent-pref-service-row";
    if (svc.id === selectedServiceId) row.classList.add("is-selected");

    const isDefault = svc.id === activeId;
    const label = doc.createElementNS(XHTML_NS, "span");
    label.className = "zoteroagent-pref-service-label";
    label.textContent = `${svc.name}${isDefault ? " ★" : ""}  —  ${svc.model}`;
    if (isDefault) label.classList.add("is-default");

    row.appendChild(label);
    row.addEventListener("click", () => onSelect(svc.id));
    container.appendChild(row);
  }

  if (services.length === 0) {
    const empty = doc.createElementNS(XHTML_NS, "div");
    empty.className = "zoteroagent-pref-services-empty";
    empty.textContent = getString("pref-svc-empty");
    container.appendChild(empty);
  }
}
