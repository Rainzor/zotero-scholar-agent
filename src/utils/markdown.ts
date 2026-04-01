import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";
import katex from "katex";

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  xhtmlOut: true,
});

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
