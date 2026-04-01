import { getActiveService } from "../utils/services";
import { getPreset } from "../utils/provider-presets";
import type { ProviderKey, ApiFormat, AuthType } from "../addon";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

type StreamState = {
  content: string;
  reasoning: string;
};

type ChatOptions = {
  stream?: boolean;
  onChunk?: (state: StreamState) => void;
  onRequest?: (xhr: XMLHttpRequest) => void;
  disableThinking?: boolean;
};

type ServiceConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  provider: ProviderKey;
  apiFormat: ApiFormat;
  authType: AuthType;
};

export class AIService {
  static getConfig(): ServiceConfig {
    const svc = getActiveService();
    const preset = getPreset(svc?.provider || "custom");
    return {
      apiUrl: svc?.apiUrl || "",
      apiKey: svc?.apiKey || "",
      model: svc?.model || "",
      provider: svc?.provider || "custom",
      apiFormat: svc?.apiFormat || preset?.apiFormat || "chat-completions",
      authType: preset?.authType || "bearer",
    };
  }

  private static supportsThinking(provider: ProviderKey): boolean {
    return getPreset(provider)?.supportsThinking ?? false;
  }

  private static buildHeaders(cfg: ServiceConfig): Record<string, string> {
    if (cfg.authType === "x-api-key") {
      return {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      };
    }
    if (cfg.authType === "api-key") {
      return { "Content-Type": "application/json", "api-key": cfg.apiKey };
    }
    return { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` };
  }

  private static buildBody(
    cfg: ServiceConfig,
    messages: ChatMessage[],
    stream: boolean,
    canThink: boolean,
    disableThinking: boolean,
  ): string {
    if (cfg.apiFormat === "anthropic") {
      const systemParts = messages.filter((m) => m.role === "system");
      const nonSystem = messages.filter((m) => m.role !== "system");
      const systemText = systemParts.map((m) => m.content).join("\n");
      return JSON.stringify({
        model: cfg.model,
        ...(systemText ? { system: systemText } : {}),
        messages: nonSystem,
        max_tokens: 16384,
        stream,
        ...(canThink
          ? {
              thinking: disableThinking
                ? { type: "disabled" }
                : { type: "adaptive" },
            }
          : {}),
      });
    }
    if (cfg.apiFormat === "responses") {
      const reasoning =
        canThink
          ? (disableThinking
            ? { effort: "none" }
            : { effort: "medium", summary: "auto" })
          : undefined;
      return JSON.stringify({
        model: cfg.model,
        input: messages,
        stream,
        ...(reasoning ? { reasoning } : {}),
      });
    }
    return JSON.stringify({
      model: cfg.model,
      messages,
      stream,
      ...(canThink && disableThinking ? { thinking: { type: "disabled" } } : {}),
    });
  }

  private static parseChatCompletionsSSE(
    raw: string,
    canThink: boolean,
    disableThinking: boolean,
  ): { content: string; reasoning: string } {
    const lines = raw.match(/data: (.+)/g) || [];
    let content = "";
    let reasoning = "";
    for (const line of lines) {
      if (line.indexOf("[DONE]") !== -1) continue;
      try {
        const payload = JSON.parse(line.replace("data: ", ""));
        const delta = payload.choices?.[0]?.delta;
        if (!delta) continue;
        if (!disableThinking && canThink && delta.reasoning_content) reasoning += delta.reasoning_content;
        if (delta.content) content += delta.content;
      } catch {
        // ignore transient parse errors
      }
    }
    return { content, reasoning };
  }

  private static parseResponsesSSE(
    raw: string,
    canThink: boolean,
    disableThinking: boolean,
  ): { content: string; reasoning: string } {
    const lines = raw.match(/data: (.+)/g) || [];
    let content = "";
    let reasoning = "";
    for (const line of lines) {
      if (line.indexOf("[DONE]") !== -1) continue;
      try {
        const payload = JSON.parse(line.replace("data: ", ""));
        const type = payload.type as string | undefined;
        if (type === "response.output_text.delta") {
          content += payload.delta || "";
        } else if (
          !disableThinking &&
          canThink &&
          (type === "response.reasoning_summary_text.delta" ||
            type === "response.reasoning_summary.delta")
        ) {
          reasoning += payload.delta || "";
        }
      } catch {
        // ignore transient parse errors
      }
    }
    return { content, reasoning };
  }

  private static parseAnthropicSSE(raw: string): { content: string; reasoning: string } {
    const lines = raw.match(/data: (.+)/g) || [];
    let content = "";
    let reasoning = "";
    for (const line of lines) {
      if (line.indexOf("[DONE]") !== -1) continue;
      try {
        const payload = JSON.parse(line.replace("data: ", ""));
        if (payload.type === "content_block_delta") {
          const delta = payload.delta;
          if (delta?.type === "text_delta" && delta.text) {
            content += delta.text;
          } else if (delta?.type === "thinking_delta" && delta.thinking) {
            reasoning += delta.thinking;
          }
        }
      } catch {
        // ignore transient parse errors
      }
    }
    return { content, reasoning };
  }

  private static parseAnthropicJSON(resp: any): { content: string; reasoning: string } {
    const blocks: any[] = resp?.content || [];
    let content = "";
    let reasoning = "";
    for (const block of blocks) {
      if (block.type === "text" && block.text) content += block.text;
      else if (block.type === "thinking" && block.thinking) reasoning += block.thinking;
    }
    return { content, reasoning };
  }

  private static parseChatCompletionsJSON(
    resp: any,
    canThink: boolean,
    disableThinking: boolean,
  ): { content: string; reasoning: string } {
    const choice = resp?.choices?.[0];
    const content = choice?.message?.content || "";
    const reasoning = !disableThinking && canThink ? choice?.message?.reasoning_content || "" : "";
    return { content, reasoning };
  }

  private static parseResponsesJSON(
    resp: any,
    canThink: boolean,
    disableThinking: boolean,
  ): { content: string; reasoning: string } {
    const output: any[] = resp?.output || [];
    let content = "";
    let reasoning = "";
    for (const item of output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === "output_text" && part.text) content += part.text;
        }
      } else if (!disableThinking && canThink && item.type === "reasoning" && Array.isArray(item.summary)) {
        for (const s of item.summary) {
          if (s.type === "summary_text" && s.text) reasoning += s.text;
          else if (typeof s.text === "string") reasoning += s.text;
        }
      }
    }
    return { content, reasoning };
  }

  static async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<StreamState> {
    const { stream = true, onChunk, onRequest, disableThinking = false } = options;
    const cfg = AIService.getConfig();
    if (!cfg.apiUrl || !cfg.apiKey) {
      throw new Error("API URL or API Key is not configured. Add a service in preferences.");
    }

    const canThink = AIService.supportsThinking(cfg.provider);
    const headers = AIService.buildHeaders(cfg);
    const body = AIService.buildBody(cfg, messages, stream, canThink, disableThinking);
    const fmt = cfg.apiFormat;
    const state: StreamState = { content: "", reasoning: "" };

    if (stream) {
      let prevContent = "";
      let prevReasoning = "";

      const parseSSE = (raw: string) => {
        if (fmt === "anthropic") return AIService.parseAnthropicSSE(raw);
        if (fmt === "responses") return AIService.parseResponsesSSE(raw, canThink, disableThinking);
        return AIService.parseChatCompletionsSSE(raw, canThink, disableThinking);
      };

      const emit = () => {
        if (state.content !== prevContent || state.reasoning !== prevReasoning) {
          prevContent = state.content;
          prevReasoning = state.reasoning;
          onChunk?.({ ...state });
        }
      };

      try {
        await Zotero.HTTP.request("POST", cfg.apiUrl, {
          headers,
          body,
          responseType: "text",
          timeout: disableThinking ? 60000 : 300000,
          requestObserver: (xmlhttp: XMLHttpRequest) => {
            onRequest?.(xmlhttp);
            xmlhttp.onprogress = () => {
              try {
                const parsed = parseSSE(xmlhttp.responseText || "");
                state.content = parsed.content;
                state.reasoning = parsed.reasoning;
                emit();
              } catch {
                // ignore
              }
            };
          },
        });
      } catch (e: any) {
        AIService.throwApiError(e);
      }

      const finalParsed = parseSSE(
        (Zotero as any)._lastXMLHttpRequest?.responseText || "",
      );
      if (finalParsed.content) state.content = finalParsed.content;
      if (finalParsed.reasoning) state.reasoning = finalParsed.reasoning;
      emit();
      return state;
    }

    try {
      const response = await Zotero.HTTP.request("POST", cfg.apiUrl, {
        headers,
        body,
        responseType: "json",
        timeout: disableThinking ? 60000 : 300000,
      });
      const resp = response.response;
      const parsed =
        fmt === "anthropic" ? AIService.parseAnthropicJSON(resp) :
        fmt === "responses" ? AIService.parseResponsesJSON(resp, canThink, disableThinking) :
        AIService.parseChatCompletionsJSON(resp, canThink, disableThinking);
      state.content = parsed.content;
      state.reasoning = parsed.reasoning;
    } catch (e: any) {
      AIService.throwApiError(e);
    }

    onChunk?.({ ...state });
    return state;
  }

  private static throwApiError(e: any): never {
    try {
      const payload = JSON.parse(e?.xmlhttp?.response);
      const err = payload?.error || payload;
      throw new Error(`${err?.type || "request_error"}: ${err?.message || e}`);
    } catch (e2) {
      if (e2 instanceof Error && e2.message.includes("request_error")) throw e2;
      throw e;
    }
  }
}
