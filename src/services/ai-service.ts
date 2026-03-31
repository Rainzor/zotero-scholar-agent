import { getPref } from "../utils/prefs";
import { getActiveService } from "../utils/services";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

type ChatOptions = {
  stream?: boolean;
  onChunk?: (chunk: string, fullText: string) => void;
};

export class AIService {
  static getConfig() {
    const svc = getActiveService();
    const apiUrl = svc?.apiUrl || "";
    const apiKey = svc?.apiKey || "";
    const model = svc?.model || "";
    const temperature = Number(getPref("temperature") || "0.3");
    return { apiUrl, apiKey, model, temperature };
  }

  static async chat(messages: ChatMessage[], options: ChatOptions = {}) {
    const { stream = true, onChunk } = options;
    const { apiUrl, apiKey, model, temperature } = AIService.getConfig();
    if (!apiUrl || !apiKey) {
      throw new Error("API URL or API Key is not configured. Add a service in preferences.");
    }

    let textArr: string[] = [];
    let finalText = "";
    let previousLen = 0;

    const emit = () => {
      const fullText = textArr.join("");
      if (fullText.length > previousLen) {
        const delta = fullText.slice(previousLen);
        previousLen = fullText.length;
        onChunk?.(delta, fullText);
      }
    };

    if (stream) {
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
            temperature,
          }),
          responseType: "text",
          requestObserver: (xmlhttp: XMLHttpRequest) => {
            xmlhttp.onprogress = (event: any) => {
              try {
                textArr = (event.target.response.match(/data: (.+)/g) || [])
                  .filter((line: string) => line.indexOf("[DONE]") === -1)
                  .map((line: string) => {
                    try {
                      const payload = JSON.parse(line.replace("data: ", ""));
                      return payload.choices?.[0]?.delta?.content || "";
                    } catch {
                      return "";
                    }
                  })
                  .filter(Boolean);
                emit();
              } catch (_e) {
                // Ignore transient parse errors during stream.
              }
            };
          },
        });
      } catch (e: any) {
        try {
          const payload = JSON.parse(e?.xmlhttp?.response);
          const err = payload?.error || payload;
          throw new Error(`${err?.type || "request_error"}: ${err?.message || e}`);
        } catch {
          throw e;
        }
      }
      finalText = textArr.join("");
      emit();
      return finalText;
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
          temperature,
        }),
        responseType: "json",
      });
      finalText = response.response?.choices?.[0]?.message?.content || "";
    } catch (e: any) {
      try {
        const payload = JSON.parse(e?.xmlhttp?.response);
        const err = payload?.error || payload;
        throw new Error(`${err?.type || "request_error"}: ${err?.message || e}`);
      } catch {
        throw e;
      }
    }

    onChunk?.(finalText, finalText);
    return finalText;
  }
}
