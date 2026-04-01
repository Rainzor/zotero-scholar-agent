import { config } from "../package.json";
import { createZToolkit } from "./utils/ztoolkit";
import hooks from "./hooks";
import api from "./api";

export type ContextMode = "none" | "currentPage" | "fullPdf";
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  timestamp?: number;
};
export type ChatSession = {
  sessionId: string;
  itemId: number;
  itemKey: string;
  title: string;
  messages: ChatMessage[];
  contextMode: ContextMode;
  createdAt: number;
  updatedAt: number;
};
export type ProviderKey =
  | "openai"
  | "azure"
  | "azureAnthropic"
  | "anthropic"
  | "deepseek"
  | "kimi"
  | "gemini"
  | "glm"
  | "minimax"
  | "qwen"
  | "custom";

export type ApiFormat = "chat-completions" | "responses" | "anthropic";
export type AuthType = "bearer" | "api-key" | "x-api-key";

export type ServiceProvider = {
  id: string;
  name: string;
  provider: ProviderKey;
  apiFormat: ApiFormat;
  apiUrl: string;
  apiKey: string;
  model: string;
};

class Addon {
  public data: {
    config: typeof config;
    alive: boolean;
    env: "development" | "production";
    ztoolkit: ReturnType<typeof createZToolkit>;
    locale: {
      current?: any;
    };
    prefs: {
      window: Window | null;
    };
    popup: {
      currentPopup: HTMLDivElement | null;
      selectedText: string;
      currentReader: _ZoteroTypes.ReaderInstance | null;
    };
    panel: {
      activePanels: Record<string, () => void>;
      standaloneWindow: Window | null;
    };
    chat: {
      prefillInput: string;
      referenceText: string;
      contextMode: ContextMode;
    };
  };
  public hooks: typeof hooks;
  public api: typeof api;

  constructor() {
    this.data = {
      config,
      alive: true,
      env: __env__,
      ztoolkit: createZToolkit(),
      locale: {},
      prefs: { window: null },
      popup: { currentPopup: null, selectedText: "", currentReader: null },
      panel: { activePanels: {}, standaloneWindow: null },
      chat: {
        prefillInput: "",
        referenceText: "",
        contextMode: "currentPage",
      },
    };
    this.hooks = hooks;
    this.api = api;
  }
}

export default Addon;
