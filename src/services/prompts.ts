type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

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
