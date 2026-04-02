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
  source: "none" | "currentPage";
  pageNumber?: number;
};

export function askPrompt(
  question: string,
  ctx: ContextInfo,
  paperOverview?: string,
): ChatMessage[] {
  let systemMsg =
    "You are an academic PDF reading assistant that helps users understand paper content. Respond in the same language the user uses.\n" +
    "The user's message may contain quoted paragraphs starting with >, which are excerpts selected from the PDF. Use these quotes to inform your answers.";
  const overview = (paperOverview || "").trim();
  if (overview) {
    systemMsg +=
      "\nBelow is the AGENTS.md structured overview for this paper. Prioritize using its section index and page tags to locate evidence; when the current page lacks sufficient information, suggest the user navigate to the relevant page based on the index.\n" +
      `\n[AGENTS.md]\n${overview}`;
  }

  let userContent = "";

  if (ctx.source === "none" || !ctx.text) {
    userContent = question;
  } else if (ctx.source === "currentPage") {
    const pageLabel = ctx.pageNumber ? ` (page ${ctx.pageNumber})` : "";
    systemMsg +=
      `\nBelow is the full text of the PDF page${pageLabel} the user is currently reading. Use the page content to inform your answer.`;
    userContent = `[Current page content${pageLabel}]\n${ctx.text}\n\n[Question]\n${question}`;
  }

  return [
    { role: "system", content: systemMsg },
    { role: "user", content: userContent },
  ];
}

export function initPaperPrompt(text: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are an academic paper knowledge compiler. Convert the full paper into a reusable AGENTS.md. Be accurate, consistent in structure, and avoid speculation.",
    },
    {
      role: "user",
      content:
        "Based on the full paper below, generate an AGENTS.md (Markdown) and strictly include these top-level headings:\n" +
        "1. Paper Metadata\n" +
        "2. Abstract / TL;DR\n" +
        "3. Key Contributions\n" +
        "4. Methodology Overview\n" +
        "5. Main Results\n" +
        "6. Section Index\n\n" +
        "Requirements:\n" +
        "- In Section Index, provide approximate page ranges and paragraph clues for each key section.\n" +
        "- Use page tags in the format [p.X-Y] or [p.X].\n" +
        "- If any detail is uncertain, explicitly mark it as Uncertain.\n" +
        "- Keep the output concise and directly reusable for downstream Q&A.\n\n" +
        `Full paper text:\n${text}`,
    },
  ];
}

export function paperSummaryPrompt(
  text: string,
  paperOverview?: string,
): ChatMessage[] {
  const overview = (paperOverview || "").trim();
  return [
    {
      role: "system",
      content:
        "You are an academic paper analysis assistant.\n" +
        "Respond in the user's language.\n" +
        "Your job is to produce a reader-friendly, evidence-grounded summary of a paper.\n" +
        "Use only information supported by the provided paper text or the AGENTS.md overview.\n" +
        "If a detail is unclear, incomplete, or missing, say so explicitly instead of guessing.\n" +
        "Distinguish between the authors' goals, the method itself, the claimed contributions, and the empirical evidence.\n" +
        "Prefer concrete and precise statements over generic academic wording.",
    },
    {
      role: "user",
      content:
        "Using the paper information below, produce a structured paper summary. You MUST use the following five section headers in this exact order:\n" +
        "## Overview\n" +
        "## How This Work Fits into the Broader Research Landscape\n" +
        "## Key Objectives and Motivation\n" +
        "## Methodology and Approach\n" +
        "## Main Findings and Results\n\n" +
        "Requirements:\n" +
        "- The Overview section must be a concise 2-4 sentence paragraph, not bullet points. It should explain what problem the paper addresses, what the core idea is, what the main contribution appears to be, and why the paper matters.\n" +
        "- The remaining four sections should use 3-6 bullet points each.\n" +
        "- In 'How This Work Fits into the Broader Research Landscape', explain the research area, what gap or limitation in prior work the paper is addressing, and how it relates to existing approaches.\n" +
        "- In 'Key Objectives and Motivation', explain the research goals, the motivation behind the work, and what the authors are trying to demonstrate or solve.\n" +
        "- In 'Methodology and Approach', describe the actual mechanism, workflow, model design, or experimental procedure. Avoid vague phrases like 'the authors propose a novel framework' unless you explain what it does.\n" +
        "- In 'Main Findings and Results', summarize the strongest findings and how well they are supported by the provided text. Make clear when something is a claimed result versus directly evidenced in the text.\n" +
        "- When possible, ground points in explicit evidence from the provided text or AGENTS.md overview, including section names, page hints, or structural cues.\n" +
        "- If the provided paper text appears truncated or incomplete, avoid overstating completeness.\n" +
        "- Do not hallucinate datasets, baselines, numerical results, or conclusions.\n\n" +
        (overview
          ? `AGENTS.md overview (compressed guide; use it as supporting context, especially for structure and page hints):\n${overview}\n\n`
          : "") +
        `Full paper text (may be truncated):\n${text}`,
    },
  ];
}

export function summarizePrompt(text: string): ChatMessage[] {
  return paperSummaryPrompt(text);
}

export function sessionTitlePrompt(
  userMessage: string,
  assistantMessage: string,
): ChatMessage[] {
  const userSnippet = userMessage.slice(0, 300);
  const assistantSnippet = assistantMessage.slice(0, 500);
  return [
    {
      role: "system",
      content:
        "Generate a short title (max 10 words) for the following conversation. " +
        "Use the same language as the user's message. " +
        "Output only the title text, no quotes, no punctuation at the end, no explanation.",
    },
    {
      role: "user",
      content: `User: ${userSnippet}\n\nAssistant: ${assistantSnippet}`,
    },
  ];
}

export function summarizeHistoryPrompt(
  previousSummary: string,
  deltaMessages: ChatMessage[],
): ChatMessage[] {
  const deltaText = deltaMessages
    .map((m) => `- ${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
  const base = previousSummary?.trim()
    ? `Existing session summary:\n${previousSummary}\n\n`
    : "";
  return [
    {
      role: "system",
      content:
        "You are a conversation memory compressor. Condense multi-turn dialogue into stable, concise, reusable memory without speculation. Use the following sections:\n" +
        "1) User Goals\n2) Confirmed Facts\n3) Decisions Made\n4) Open Questions\n5) Constraints and Preferences\n" +
        "Provide 1-5 bullet points per section, and prioritize paper terminology and key conclusions.",
    },
    {
      role: "user",
      content:
        `${base}New dialogue fragments:\n${deltaText}\n\n` +
        "Please generate a new complete session summary (overwrite the old summary and incorporate the new fragments).",
    },
  ];
}
