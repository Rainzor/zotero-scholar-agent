declare module "markdown-it-texmath" {
  import type MarkdownIt from "markdown-it";
  interface TexMathOptions {
    engine?: { renderToString: (tex: string, options?: Record<string, unknown>) => string };
    delimiters?: string;
    katexOptions?: Record<string, unknown>;
  }
  const texmath: MarkdownIt.PluginWithOptions<TexMathOptions>;
  export default texmath;
}
