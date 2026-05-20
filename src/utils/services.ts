import { getPref, setPref } from "./prefs";
import { getPreset } from "./provider-presets";
import type { ServiceProvider, ProviderKey } from "../addon";

function inferProvider(apiUrl: string): ProviderKey {
  if (!apiUrl) return "custom";
  const url = apiUrl.toLowerCase();
  if (url.includes("llm-proxy.forgeax.com")) return "litellm";
  if (url.includes("services.ai.azure") && url.includes("/anthropic/"))
    return "azureAnthropic";
  if (url.includes("anthropic.com") || url.includes("anthropic/v1/messages"))
    return "anthropic";
  if (url.includes("azure") || url.includes("services.ai.azure"))
    return "azure";
  if (url.includes("deepseek")) return "deepseek";
  if (url.includes("moonshot")) return "kimi";
  if (url.includes("generativelanguage.googleapis")) return "gemini";
  if (url.includes("bigmodel.cn") || url.includes("api.z.ai")) return "glm";
  if (url.includes("minimax")) return "minimax";
  if (url.includes("dashscope.aliyuncs")) return "qwen";
  if (url.includes("openai.com")) return "openai";
  return "custom";
}

export function loadServices(): ServiceProvider[] {
  try {
    const raw = (getPref("services") as string) || "[]";
    const list = JSON.parse(raw) as ServiceProvider[];
    let migrated = false;
    for (const svc of list) {
      if (!svc.provider) {
        svc.provider = inferProvider(svc.apiUrl);
        migrated = true;
      }
      if (!svc.apiFormat) {
        const preset = getPreset(svc.provider);
        svc.apiFormat = preset?.apiFormat || "chat-completions";
        migrated = true;
      }
    }
    if (migrated) saveServices(list);
    return list;
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
