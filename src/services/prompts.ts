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

export type ContextInfo = {
  text: string;
  source: "none" | "currentPage" | "fullPdf";
  pageNumber?: number;
};

export function askPrompt(question: string, ctx: ContextInfo): ChatMessage[] {
  let systemMsg =
    "你是一个学术 PDF 阅读助手，帮助用户理解论文内容。回答语言跟随用户提问的语言。\n" +
    "用户的消息中可能包含以 > 开头的引用段落，这些是从 PDF 中选取的原文片段，请结合引用内容回答问题。";

  let userContent = "";

  if (ctx.source === "none" || !ctx.text) {
    userContent = question;
  } else if (ctx.source === "currentPage") {
    const pageLabel = ctx.pageNumber ? ` (第 ${ctx.pageNumber} 页)` : "";
    systemMsg +=
      `\n以下是用户正在阅读的 PDF 当前页面${pageLabel}的完整文字内容。请结合该页面的内容来回答。`;
    userContent = `【当前页面内容${pageLabel}】\n${ctx.text}\n\n【问题】\n${question}`;
  } else if (ctx.source === "fullPdf") {
    systemMsg +=
      "\n以下是用户正在阅读的整篇 PDF 的全文内容（已截去参考文献部分）。请结合全文来回答。";
    userContent = `【PDF 全文】\n${ctx.text}\n\n【问题】\n${question}`;
  }

  return [
    { role: "system", content: systemMsg },
    { role: "user", content: userContent },
  ];
}

export function summarizePrompt(text: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是一个学术论文分析助手。请用用户的语言回答。对论文进行深入且结构化的分析。",
    },
    {
      role: "user",
      content: `请对以下论文内容进行深入分析，包括：核心研究问题、主要方法与技术路线、关键发现/结果、创新点、局限性与未来方向。\n\n${text}`,
    },
  ];
}
