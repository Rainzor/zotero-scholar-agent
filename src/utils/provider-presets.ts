import type { ProviderKey, ApiFormat, AuthType } from "../addon";

export type ProviderPreset = {
  key: ProviderKey;
  label: string;
  apiUrl: string;
  defaultModel: string;
  miniModel?: string;
  maxContextTokens: number;
  apiFormat: ApiFormat;
  authType: AuthType;
  supportsThinking: boolean;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "openai",
    label: "OpenAI",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-5.4",
    miniModel: "gpt-4o-mini",
    maxContextTokens: 128000,
    apiFormat: "chat-completions",
    authType: "bearer",
    supportsThinking: false,
  },
  {
    key: "azure",
    label: "Azure OpenAI",
    apiUrl: "",
    defaultModel: "gpt-5.4",
    miniModel: "gpt-5.4",
    maxContextTokens: 128000,
    apiFormat: "responses",
    authType: "api-key",
    supportsThinking: true,
  },
  {
    key: "azureAnthropic",
    label: "Azure Anthropic",
    apiUrl: "",
    defaultModel: "claude-sonnet-4-6",
    miniModel: "claude-haiku-3-5",
    maxContextTokens: 200000,
    apiFormat: "anthropic",
    authType: "x-api-key",
    supportsThinking: true,
  },
  {
    key: "anthropic",
    label: "Anthropic",
    apiUrl: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-opus-4-6",
    miniModel: "claude-sonnet-4-6",
    maxContextTokens: 200000,
    apiFormat: "anthropic",
    authType: "x-api-key",
    supportsThinking: true,
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    apiUrl: "https://api.deepseek.com/v1/chat/completions",
    defaultModel: "deepseek-reasoner",
    miniModel: "deepseek-chat",
    maxContextTokens: 64000,
    apiFormat: "chat-completions",
    authType: "bearer",
    supportsThinking: true,
  },
  {
    key: "kimi",
    label: "Kimi (Moonshot)",
    apiUrl: "https://api.moonshot.cn/v1/chat/completions",
    defaultModel: "moonshot-v1-auto",
    miniModel: "moonshot-v1-8k",
    maxContextTokens: 128000,
    apiFormat: "chat-completions",
    authType: "bearer",
    supportsThinking: true,
  },
  {
    key: "gemini",
    label: "Gemini (Google)",
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultModel: "gemini-2.0-flash",
    miniModel: "gemini-2.0-flash-lite",
    maxContextTokens: 1000000,
    apiFormat: "chat-completions",
    authType: "bearer",
    supportsThinking: false,
  },
  {
    key: "glm",
    label: "GLM (Z.AI / 智谱)",
    apiUrl: "https://api.z.ai/api/paas/v4/chat/completions",
    defaultModel: "glm-5",
    miniModel: "glm-4-flash",
    maxContextTokens: 128000,
    apiFormat: "chat-completions",
    authType: "bearer",
    supportsThinking: true,
  },
  {
    key: "minimax",
    label: "MiniMax",
    apiUrl: "https://api.minimax.io/v1/chat/completions",
    defaultModel: "MiniMax-M2.5",
    miniModel: "MiniMax-M2.5",
    maxContextTokens: 1000000,
    apiFormat: "chat-completions",
    authType: "bearer",
    supportsThinking: false,
  },
  {
    key: "qwen",
    label: "Qwen (通义千问)",
    apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    defaultModel: "qwen-plus",
    miniModel: "qwen-turbo",
    maxContextTokens: 128000,
    apiFormat: "chat-completions",
    authType: "bearer",
    supportsThinking: false,
  },
  {
    key: "custom",
    label: "Custom",
    apiUrl: "",
    defaultModel: "",
    maxContextTokens: 32000,
    apiFormat: "chat-completions",
    authType: "bearer",
    supportsThinking: false,
  },
];

export function getPreset(key: ProviderKey): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.key === key);
}
