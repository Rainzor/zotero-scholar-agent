import { describe, expect, it } from "vitest";
import { buildConfigFromService } from "../src/services/ai-service";
import type { ServiceProvider } from "../src/addon";

describe("buildConfigFromService", () => {
  it("returns empty defaults for an undefined service", () => {
    expect(buildConfigFromService(undefined)).toEqual({
      apiUrl: "",
      apiKey: "",
      model: "",
      provider: "custom",
      apiFormat: "chat-completions",
      authType: "bearer",
    });
  });

  it("derives apiFormat/authType from the preset when the service omits them", () => {
    const svc = {
      id: "svc_1",
      name: "Anthropic",
      provider: "anthropic",
      apiUrl: "https://api.anthropic.com/v1/messages",
      apiKey: "sk-test",
      model: "claude-sonnet-5",
    } as unknown as ServiceProvider;
    const cfg = buildConfigFromService(svc);
    expect(cfg.apiFormat).toBe("anthropic");
    expect(cfg.authType).toBe("x-api-key");
    expect(cfg.apiUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(cfg.apiKey).toBe("sk-test");
    expect(cfg.model).toBe("claude-sonnet-5");
  });

  it("prefers an explicit apiFormat on the service over the preset's", () => {
    const svc = {
      id: "svc_2",
      name: "Custom Anthropic-shaped",
      provider: "custom",
      apiFormat: "anthropic",
      apiUrl: "https://example.com",
      apiKey: "key",
      model: "m",
    } as unknown as ServiceProvider;
    expect(buildConfigFromService(svc).apiFormat).toBe("anthropic");
  });
});
