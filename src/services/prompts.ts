type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export function explainPrompt(text: string, context?: string): ChatMessage[] {
  const body = context
    ? `Text:\n${text}\n\nContext:\n${context}`
    : `Text:\n${text}`;
  return [
    {
      role: "system",
      content:
        "You explain academic content clearly and accurately for researchers.",
    },
    {
      role: "user",
      content: `${body}\n\nExplain the text in concise bullet points and keep key terms in original language when needed.`,
    },
  ];
}

export function translatePrompt(
  text: string,
  targetLanguage: string,
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a precise academic translator. Preserve technical meaning and notation.",
    },
    {
      role: "user",
      content: `Translate the following text to ${targetLanguage}. Output translation only.\n\n${text}`,
    },
  ];
}

export function askPrompt(question: string, context?: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a PDF reading assistant. Use provided context first. If context is missing, answer cautiously.",
    },
    {
      role: "user",
      content: context
        ? `Question:\n${question}\n\nContext:\n${context}`
        : `Question:\n${question}`,
    },
  ];
}

export function summarizePrompt(text: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You summarize academic writing with high signal and minimal fluff.",
    },
    {
      role: "user",
      content: `Summarize the following content with key findings, methods, and limitations:\n\n${text}`,
    },
  ];
}
