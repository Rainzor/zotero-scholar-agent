import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";
import katex from "katex";

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  xhtmlOut: true,
});

const vaultMemoryReference = /\b([A-Z0-9]{8}\/memory\.md)\b/g;

const renderLinkOpen = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet("href") || "";
  if (isVaultMemoryReference(href)) tokens[idx].attrSet("title", href);
  return renderLinkOpen
    ? renderLinkOpen(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
};

md.renderer.rules.text = (tokens, idx) => {
  const token = tokens[idx];
  const previous = tokens[idx - 1];
  const linkedPath =
    previous?.type === "link_open" &&
    isVaultMemoryReference(previous.attrGet("href") || "");
  if (linkedPath && isVaultMemoryReference(token.content)) return "memory.md";

  return token.content.replace(vaultMemoryReference, (reference) => {
    const escaped = md.utils.escapeHtml(reference);
    return `<a href="${escaped}" title="${escaped}">memory.md</a>`;
  });
};

md.use(texmath, {
  engine: katex,
  delimiters: "dollars",
  katexOptions: {
    throwOnError: false,
    output: "htmlAndMathml",
  },
});

md.use(texmath, {
  engine: katex,
  delimiters: "brackets",
  katexOptions: {
    throwOnError: false,
    output: "htmlAndMathml",
  },
});

export function renderMarkdown(input: string) {
  return md.render(input || "");
}

function isVaultMemoryReference(value: string): boolean {
  return /^[A-Z0-9]{8}\/memory\.md$/.test(String(value || ""));
}
