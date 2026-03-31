import { getPref, setPref } from "./prefs";
import type { ServiceProvider } from "../addon";

export function loadServices(): ServiceProvider[] {
  try {
    const raw = (getPref("services") as string) || "[]";
    return JSON.parse(raw) as ServiceProvider[];
  } catch {
    return [];
  }
}

export function saveServices(list: ServiceProvider[]) {
  setPref("services", JSON.stringify(list));
}

export function getActiveServiceId(): string {
  return (getPref("activeServiceId") as string) || "";
}

export function setActiveServiceId(id: string) {
  setPref("activeServiceId", id);
}

export function getActiveService(): ServiceProvider | undefined {
  const list = loadServices();
  const activeId = getActiveServiceId();
  return list.find((s) => s.id === activeId) || list[0];
}
