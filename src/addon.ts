import { config } from "../package.json";
import { createZToolkit } from "./utils/ztoolkit";
import type { ContextDigestSource } from "./services/context-digest";
import type { SemanticRelationship } from "./services/codex/vault-format";
import type { KnowledgeQualityReport } from "./services/knowledge-quality";
import type { LocalImageRef } from "./services/local-images";
import hooks from "./hooks";
import api from "./api";

export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  contextWindowTokens?: number;
  effectiveContextWindowTokens?: number;
  contextUsedPercent?: number;
  contextSource?: "codex-config" | "codex-catalog" | "manual" | "unknown";
  modelSlug?: string;
};
export type CodexActivity = {
  command: string;
  status?: string;
  exitCode?: number | null;
};
export type PaperContext = {
  itemKey: string;
  title: string;
  creators?: string;
  year?: string;
};
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  timestamp?: number;
  model?: string;
  usage?: TokenUsage;
  activities?: CodexActivity[];
  memoryUpdated?: boolean;
  committed?: boolean;
  contextPapers?: PaperContext[];
  relationshipUpdates?: SemanticRelationship[];
  quality?: KnowledgeQualityReport;
  imageRefs?: LocalImageRef[];
  keywordSuggestions?: string[];
};
export type ChatSession = {
  sessionId: string;
  itemId: number;
  itemKey: string;
  codexThreadId?: string;
  modelSlug?: string;
  contextDigest?: string;
  contextDigestUpToMessageIndex?: number;
  contextDigestUpdatedAt?: number;
  contextDigestTokenEstimate?: number;
  contextDigestSource?: ContextDigestSource;
  title: string;
  messages: ChatMessage[];
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
      mentionedPapers: PaperContext[];
      pendingImages: LocalImageRef[];
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
        mentionedPapers: [],
        pendingImages: [],
      },
    };
    this.hooks = hooks;
    this.api = api;
  }
}

export default Addon;
