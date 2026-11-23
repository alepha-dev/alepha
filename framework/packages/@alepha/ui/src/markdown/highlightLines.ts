import { createLowlight } from "lowlight";

import { HIGHLIGHT_LANGUAGES } from "./rehypeHighlight.ts";

/**
 * One piece of a highlighted line: its text, and the highlight.js classes
 * (`hljs-keyword`, ...) of every token it sits in, outermost first.
 */
export interface HighlightToken {
  value: string;
  className?: string;
}

/**
 * The subset of a lowlight node this walk reads.
 */
interface HastLike {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastLike[];
}

let shared: ReturnType<typeof createLowlight> | undefined;

/**
 * Highlight `text` line by line, with the grammars `MarkdownView` uses
 * ({@link HIGHLIGHT_LANGUAGES}): a code browser or a diff numbers each line
 * and needs its tokens per line, which highlight.js does not give.
 *
 * A token that spans lines (a block comment, a template string) is split at
 * each newline and keeps its classes on every piece, so the second line of a
 * comment is still a comment. A language that is not registered, or none,
 * answers the lines as plain text. Always one entry per line of `text`,
 * the last one empty when it ends with a newline, as `text.split("\n")`.
 */
export const highlightLines = (
  text: string,
  language?: string,
): HighlightToken[][] => {
  shared ??= createLowlight(HIGHLIGHT_LANGUAGES);
  const lines: HighlightToken[][] = [[]];
  if (!language || !shared.registered(language)) {
    return text.split("\n").map((line) => (line ? [{ value: line }] : []));
  }
  const push = (value: string, classes: string[]) => {
    const parts = value.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (!part) return;
      const className = classes.length ? classes.join(" ") : undefined;
      const line = lines[lines.length - 1]!;
      const last = line[line.length - 1];
      if (last && last.className === className) last.value += part;
      else line.push(className ? { value: part, className } : { value: part });
    });
  };
  const walk = (node: HastLike, classes: string[]) => {
    if (node.type === "text") {
      push(node.value ?? "", classes);
      return;
    }
    const own = Array.isArray(node.properties?.className)
      ? (node.properties.className as unknown[]).map(String)
      : [];
    const next = own.length ? [...classes, ...own] : classes;
    for (const child of node.children ?? []) walk(child, next);
  };
  walk(shared.highlight(language, text) as unknown as HastLike, []);
  return lines;
};

/**
 * The highlight.js grammar a file's name asks for, among
 * {@link HIGHLIGHT_LANGUAGES}, or undefined: by extension, and `Dockerfile`
 * and `Makefile`-free names by their own.
 */
export const highlightLanguageOf = (path: string): string | undefined => {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name === "dockerfile" || name.endsWith(".dockerfile")) {
    return "dockerfile";
  }
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1)
    : "";
  return HIGHLIGHT_EXTENSIONS[extension];
};

const HIGHLIGHT_EXTENSIONS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  css: "css",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  go: "go",
  rs: "rust",
  py: "python",
  sql: "sql",
  toml: "ini",
  ini: "ini",
  diff: "diff",
  patch: "diff",
};
