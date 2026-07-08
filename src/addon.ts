import { config } from "../package.json";
import { createZToolkit } from "./utils/ztoolkit";
import hooks from "./hooks";
import api from "./api";

export type ContextMode = "agent" | "none" | "currentPage";
export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};
export type ContextPdfSource = "upload" | "library";
export type SessionContextPdfRef = {
  source: ContextPdfSource;
  hash: string;
  fileName: string;
  fileSize: number;
  addedAt: number;
  itemKey?: string;
  itemId?: number;
};
export type PendingContextPdf = SessionContextPdfRef & {
  status: "uploading" | "parsing" | "overviewing" | "ready" | "error";
  error?: string;
};
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  timestamp?: number;
  model?: string;
  images?: string[];
  contextPdfRef?: { fileName: string; source?: ContextPdfSource };
  usage?: TokenUsage;
};
export type ChatSession = {
  sessionId: string;
  itemId: number;
  itemKey: string;
  codexThreadId?: string;
  title: string;
  messages: ChatMessage[];
  summaryText?: string;
  summaryUpToIndex?: number;
  summaryUpdatedAt?: number;
  contextMode: ContextMode;
  contextPdf?: SessionContextPdfRef;
  createdAt: number;
  updatedAt: number;
};
export type ProviderKey =
  | "openai"
  | "litellm"
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
  miniModel?: string;
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
      selectedPageLabel: string;
      currentReader: _ZoteroTypes.ReaderInstance | null;
    };
    panel: {
      activePanels: Record<string, () => void>;
      standaloneWindow: Window | null;
    };
    chat: {
      prefillInput: string;
      referenceText: string;
      responseQuote: string;
      pendingImages: string[];
      pendingContextPdf: PendingContextPdf | null;
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
      popup: {
        currentPopup: null,
        selectedText: "",
        selectedPageLabel: "",
        currentReader: null,
      },
      panel: { activePanels: {}, standaloneWindow: null },
      chat: {
        prefillInput: "",
        referenceText: "",
        responseQuote: "",
        pendingImages: [],
        pendingContextPdf: null,
      },
    };
    this.hooks = hooks;
    this.api = api;
  }
}

export default Addon;
