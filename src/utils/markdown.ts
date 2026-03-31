import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  xhtmlOut: true,
});

export function renderMarkdown(input: string) {
  return md.render(input || "");
}
