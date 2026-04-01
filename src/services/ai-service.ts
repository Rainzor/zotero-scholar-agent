import { getPref } from "../utils/prefs";
import { getActiveService } from "../utils/services";

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

export class AIService {
  static getConfig() {
    const svc = getActiveService();
    const apiUrl = svc?.apiUrl || "";
    const apiKey = svc?.apiKey || "";
    const model = svc?.model || "";
    return { apiUrl, apiKey, model };
  }

  static async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<StreamState> {
    const { stream = true, onChunk, onRequest, disableThinking = false } = options;
    const { apiUrl, apiKey, model } = AIService.getConfig();
    if (!apiUrl || !apiKey) {
      throw new Error("API URL or API Key is not configured. Add a service in preferences.");
    }

    const state: StreamState = { content: "", reasoning: "" };

    if (stream) {
      let prevContent = "";
      let prevReasoning = "";

      const parseSSE = (raw: string) => {
        const lines = raw.match(/data: (.+)/g) || [];
        let content = "";
        let reasoning = "";
        for (const line of lines) {
          if (line.indexOf("[DONE]") !== -1) continue;
          try {
            const payload = JSON.parse(line.replace("data: ", ""));
            const delta = payload.choices?.[0]?.delta;
            if (!delta) continue;
            if (!disableThinking && delta.reasoning_content) reasoning += delta.reasoning_content;
            if (delta.content) content += delta.content;
          } catch {
            // ignore transient parse errors
          }
        }
        return { content, reasoning };
      };

      const emit = () => {
        if (state.content !== prevContent || state.reasoning !== prevReasoning) {
          prevContent = state.content;
          prevReasoning = state.reasoning;
          onChunk?.({ ...state });
        }
      };

      try {
        await Zotero.HTTP.request("POST", apiUrl, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            ...(disableThinking
              ? { thinking: { type: "disabled" } }
              : {}),
          }),
          responseType: "text",
          timeout: disableThinking ? 60000 : 300000,
          requestObserver: (xmlhttp: XMLHttpRequest) => {
            onRequest?.(xmlhttp);
            xmlhttp.onprogress = (_event: any) => {
              try {
                const parsed = parseSSE(xmlhttp.responseText || "");
                state.content = parsed.content;
                state.reasoning = parsed.reasoning;
                emit();
              } catch (_e) {
                // ignore
              }
            };
          },
        });
      } catch (e: any) {
        try {
          const payload = JSON.parse(e?.xmlhttp?.response);
          const err = payload?.error || payload;
          throw new Error(`${err?.type || "request_error"}: ${err?.message || e}`);
        } catch (e2) {
          if (e2 instanceof Error && e2.message.includes("request_error")) throw e2;
          throw e;
        }
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
      const response = await Zotero.HTTP.request("POST", apiUrl, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          ...(disableThinking
            ? { thinking: { type: "disabled" } }
            : {}),
        }),
        responseType: "json",
        timeout: disableThinking ? 60000 : 300000,
      });
      const choice = response.response?.choices?.[0];
      state.content = choice?.message?.content || "";
      if (!disableThinking) state.reasoning = choice?.message?.reasoning_content || "";
    } catch (e: any) {
      try {
        const payload = JSON.parse(e?.xmlhttp?.response);
        const err = payload?.error || payload;
        throw new Error(`${err?.type || "request_error"}: ${err?.message || e}`);
      } catch (e2) {
        if (e2 instanceof Error && e2.message.includes("request_error")) throw e2;
        throw e;
      }
    }

    onChunk?.({ ...state });
    return state;
  }
}
