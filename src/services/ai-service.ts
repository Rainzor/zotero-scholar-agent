import { getActiveService } from "../utils/services";
import { getPreset } from "../utils/provider-presets";
import type { ProviderKey, ApiFormat, AuthType } from "../addon";
import { getImageMimeType, stripDataUrlPrefix } from "../utils/image-utils";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string | ContentPart[];
};

type StreamState = {
  content: string;
  reasoning: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

type ChatOptions = {
  stream?: boolean;
  onChunk?: (state: StreamState) => void;
  onRequest?: (xhr: XMLHttpRequest) => void;
  disableThinking?: boolean;
  timeoutMs?: number;
  model?: string;
  maxTokens?: number;
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
  static buildMultimodalUserContent(
    text: string,
    images: string[],
  ): string | ContentPart[] {
    const imageUrls = (images || [])
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    if (imageUrls.length === 0) return text;
    return [
      { type: "text", text: text || "" },
      ...imageUrls.map<ContentPart>((url) => ({
        type: "image_url",
        image_url: { url, detail: "high" },
      })),
    ];
  }

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

  private static usesMaxCompletionTokens(model: string): boolean {
    const name = model.toLowerCase();
    return (
      name.startsWith("gpt-5") ||
      name.startsWith("o") ||
      name.includes("reasoning")
    );
  }

  private static resolveApiUrl(apiUrl: string, apiFormat: ApiFormat): string {
    const cleaned = apiUrl.trim().replace(/\/+$/, "");
    if (!cleaned) return "";

    const targetSuffix =
      apiFormat === "responses"
        ? "/responses"
        : apiFormat === "anthropic"
          ? "/messages"
          : "/chat/completions";
    const defaultVersionedSuffix =
      apiFormat === "anthropic"
        ? "/v1/messages"
        : `/v1${targetSuffix}`;
    const knownEndpointPattern =
      /\/(?:chat\/completions|responses|embeddings|files|models|messages)$/i;
    const versionPathPattern = /\/v\d+(?:beta)?$/i;

    try {
      const parsed = new URL(cleaned);
      const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
      if (knownEndpointPattern.test(pathname)) {
        parsed.pathname = pathname.replace(knownEndpointPattern, targetSuffix);
      } else if (versionPathPattern.test(pathname)) {
        parsed.pathname = `${pathname}${targetSuffix}`;
      } else {
        parsed.pathname = `${pathname === "/" ? "" : pathname}${defaultVersionedSuffix}`;
      }
      return parsed.toString();
    } catch {
      if (knownEndpointPattern.test(cleaned)) {
        return cleaned.replace(knownEndpointPattern, targetSuffix);
      }
      if (versionPathPattern.test(cleaned)) {
        return `${cleaned}${targetSuffix}`;
      }
      return `${cleaned}${defaultVersionedSuffix}`;
    }
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
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    };
  }

  private static buildBody(
    cfg: ServiceConfig,
    messages: ChatMessage[],
    stream: boolean,
    canThink: boolean,
    disableThinking: boolean,
    modelOverride?: string,
    maxTokensOverride?: number,
  ): string {
    const model = modelOverride || cfg.model;
    if (cfg.apiFormat === "anthropic") {
      const systemParts = messages.filter((m) => m.role === "system");
      const nonSystem = messages.filter((m) => m.role !== "system");
      const systemText = systemParts
        .map((m) => AIService.toPlainText(m.content))
        .join("\n");
      const anthropicMessages = nonSystem.map((m) => ({
        role: m.role,
        content: AIService.toAnthropicContent(m.content),
      }));
      return JSON.stringify({
        model,
        ...(systemText ? { system: systemText } : {}),
        messages: anthropicMessages,
        max_tokens: maxTokensOverride || 16384,
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
      const reasoning = canThink
        ? disableThinking
          ? { effort: "none" }
          : { effort: "medium", summary: "auto" }
        : undefined;
      const input = messages.map((m) => ({
        role: m.role,
        content: AIService.toResponsesContent(m.role, m.content),
      }));
      return JSON.stringify({
        model,
        input,
        stream,
        max_output_tokens: maxTokensOverride || 16384,
        ...(reasoning ? { reasoning } : {}),
      });
    }
    const tokenParam = AIService.usesMaxCompletionTokens(model)
      ? { max_completion_tokens: maxTokensOverride || 16384 }
      : { max_tokens: maxTokensOverride || 16384 };
    return JSON.stringify({
      model,
      messages,
      stream,
      ...tokenParam,
      ...(canThink && disableThinking
        ? { thinking: { type: "disabled" } }
        : {}),
    });
  }

  private static toPlainText(content: string | ContentPart[]): string {
    if (typeof content === "string") return content;
    return content
      .filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join("\n");
  }

  private static toAnthropicContent(content: string | ContentPart[]): any[] {
    if (typeof content === "string") {
      return [{ type: "text", text: content }];
    }
    const blocks: any[] = [];
    for (const part of content) {
      if (part.type === "text") {
        blocks.push({ type: "text", text: part.text || "" });
        continue;
      }
      const url = part.image_url?.url || "";
      if (!url.startsWith("data:image/")) continue;
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: getImageMimeType(url),
          data: stripDataUrlPrefix(url),
        },
      });
    }
    return blocks.length ? blocks : [{ type: "text", text: "" }];
  }

  private static toResponsesContent(
    role: "user" | "assistant" | "system",
    content: string | ContentPart[],
  ): any[] {
    const textType = role === "assistant" ? "output_text" : "input_text";
    if (typeof content === "string") {
      return [{ type: textType, text: content }];
    }
    const parts: any[] = [];
    for (const part of content) {
      if (part.type === "text") {
        parts.push({ type: textType, text: part.text || "" });
      } else {
        const url = part.image_url?.url || "";
        if (!url) continue;
        if (role === "assistant") continue;
        parts.push({ type: "input_image", image_url: url });
      }
    }
    return parts.length ? parts : [{ type: textType, text: "" }];
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
        if (!disableThinking && canThink && delta.reasoning_content)
          reasoning += delta.reasoning_content;
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

  private static parseAnthropicSSE(raw: string): {
    content: string;
    reasoning: string;
  } {
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

  private static parseAnthropicJSON(resp: any): {
    content: string;
    reasoning: string;
  } {
    const blocks: any[] = resp?.content || [];
    let content = "";
    let reasoning = "";
    for (const block of blocks) {
      if (block.type === "text" && block.text) content += block.text;
      else if (block.type === "thinking" && block.thinking)
        reasoning += block.thinking;
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
    const reasoning =
      !disableThinking && canThink
        ? choice?.message?.reasoning_content || ""
        : "";
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
      } else if (
        !disableThinking &&
        canThink &&
        item.type === "reasoning" &&
        Array.isArray(item.summary)
      ) {
        for (const s of item.summary) {
          if (s.type === "summary_text" && s.text) reasoning += s.text;
          else if (typeof s.text === "string") reasoning += s.text;
        }
      }
    }
    return { content, reasoning };
  }

  static async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<StreamState> {
    const {
      stream = true,
      onChunk,
      onRequest,
      disableThinking = false,
      timeoutMs,
      model: modelOverride,
      maxTokens,
    } = options;
    const cfg = AIService.getConfig();
    const requestUrl = AIService.resolveApiUrl(cfg.apiUrl, cfg.apiFormat);
    if (!requestUrl || !cfg.apiKey) {
      throw new Error(
        "API URL or API Key is not configured. Add a service in preferences.",
      );
    }

    const canThink = AIService.supportsThinking(cfg.provider);
    const headers = AIService.buildHeaders(cfg);
    const body = AIService.buildBody(
      cfg,
      messages,
      stream,
      canThink,
      disableThinking,
      modelOverride,
      maxTokens,
    );
    const fmt = cfg.apiFormat;
    const state: StreamState = { content: "", reasoning: "" };

    const requestTimeout =
      typeof timeoutMs === "number" && timeoutMs > 0
        ? timeoutMs
        : disableThinking
          ? 60000
          : 300000;

    if (stream) {
      let prevContent = "";
      let prevReasoning = "";

      const parseSSE = (raw: string) => {
        if (fmt === "anthropic") return AIService.parseAnthropicSSE(raw);
        if (fmt === "responses")
          return AIService.parseResponsesSSE(raw, canThink, disableThinking);
        return AIService.parseChatCompletionsSSE(
          raw,
          canThink,
          disableThinking,
        );
      };

      const emit = () => {
        if (
          state.content !== prevContent ||
          state.reasoning !== prevReasoning
        ) {
          prevContent = state.content;
          prevReasoning = state.reasoning;
          onChunk?.({ ...state });
        }
      };

      try {
        await Zotero.HTTP.request("POST", requestUrl, {
          headers,
          body,
          responseType: "text",
          timeout: requestTimeout,
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

      const finalRaw = (Zotero as any)._lastXMLHttpRequest?.responseText || "";
      const finalParsed = parseSSE(finalRaw);
      if (finalParsed.content) state.content = finalParsed.content;
      if (finalParsed.reasoning) state.reasoning = finalParsed.reasoning;
      state.usage = AIService.extractUsageFromSSE(finalRaw, fmt);
      emit();
      return state;
    }

    try {
      const response = await Zotero.HTTP.request("POST", requestUrl, {
        headers,
        body,
        responseType: "json",
        timeout: requestTimeout,
      });
      const resp = response.response;
      const parsed =
        fmt === "anthropic"
          ? AIService.parseAnthropicJSON(resp)
          : fmt === "responses"
            ? AIService.parseResponsesJSON(resp, canThink, disableThinking)
            : AIService.parseChatCompletionsJSON(
                resp,
                canThink,
                disableThinking,
              );
      state.content = parsed.content;
      state.reasoning = parsed.reasoning;
      state.usage = AIService.extractUsageFromJSON(resp, fmt);
    } catch (e: any) {
      AIService.throwApiError(e);
    }

    onChunk?.({ ...state });
    return state;
  }

  private static extractUsageFromSSE(
    raw: string,
    fmt: string,
  ): StreamState["usage"] {
    const lines = raw.match(/data: (.+)/g) || [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.indexOf("[DONE]") !== -1) continue;
      try {
        const p = JSON.parse(line.replace("data: ", ""));
        const u = p.usage;
        if (u) {
          if (fmt === "anthropic") {
            return {
              promptTokens: u.input_tokens,
              completionTokens: u.output_tokens,
              totalTokens: (u.input_tokens || 0) + (u.output_tokens || 0),
            };
          }
          if (fmt === "responses") {
            return {
              promptTokens: u.input_tokens,
              completionTokens: u.output_tokens,
              totalTokens:
                u.total_tokens ||
                (u.input_tokens || 0) + (u.output_tokens || 0),
            };
          }
          return {
            promptTokens: u.prompt_tokens,
            completionTokens: u.completion_tokens,
            totalTokens: u.total_tokens,
          };
        }
      } catch {
        /* skip */
      }
    }
    return undefined;
  }

  private static extractUsageFromJSON(
    resp: any,
    fmt: string,
  ): StreamState["usage"] {
    const u = resp?.usage;
    if (!u) return undefined;
    if (fmt === "anthropic" || fmt === "responses") {
      return {
        promptTokens: u.input_tokens,
        completionTokens: u.output_tokens,
        totalTokens:
          u.total_tokens || (u.input_tokens || 0) + (u.output_tokens || 0),
      };
    }
    return {
      promptTokens: u.prompt_tokens,
      completionTokens: u.completion_tokens,
      totalTokens: u.total_tokens,
    };
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
