import { toText } from "hast-util-to-text";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";
import { visit } from "unist-util-visit";

/**
 * The grammars `MarkdownView` highlights, and the only ones in its chunk.
 *
 * `rehype-highlight` registered lowlight's `common` set, 37 grammars, and kept
 * all of them reachable whatever `languages` it was given (it reads
 * `settings.languages || common`), so the list could not shrink the bundle
 * until the plugin became this file.
 *
 * ⚠️ Twelve of these are a contract with Lore:
 * `apps/lore/src/web/app/components/shared/attachmentPreview.ts` fences a
 * text attachment with a highlight.js name (json, xml, yaml, typescript,
 * javascript, css, bash, sql, python, go, rust, ini). Drop one here and that
 * preview loses its colour, silently. `dockerfile` and `markdown` are used by
 * fences in `docs/`, and `diff` covers a diff or patch pasted into a folio.
 *
 * Each grammar brings its aliases: `ts` and `tsx` (typescript), `sh` (bash),
 * `html` (xml), `yml` (yaml), `jsonc` (json), `patch` (diff), `toml` (ini),
 * `docker` (dockerfile), `md` (markdown).
 */
export const HIGHLIGHT_LANGUAGES = {
  bash,
  css,
  diff,
  dockerfile,
  go,
  ini,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

export interface RehypeHighlightOptions {
  /**
   * Guess the language of a fence that names none, among the grammars above.
   */
  detect?: boolean;
  /**
   * Languages never highlighted: their fences stay the text the author wrote.
   */
  plainText?: readonly string[];
}

/**
 * The subset of a hast node this walk touches, declared here rather than
 * imported from `hast` for the reason `remarkSpoiler` gives for mdast.
 */
interface HighlightNode {
  type: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HighlightNode[];
}

/**
 * Syntax highlighting for `<pre><code>`, over lowlight with
 * {@link HIGHLIGHT_LANGUAGES} registered: `rehype-highlight`'s behaviour for
 * the two options `MarkdownView` uses, without its 37-grammar default.
 *
 * A fence in a language that is not registered renders as a plain code block
 * and never throws, as it did under `rehype-highlight`.
 */
export const rehypeHighlight = (options: RehypeHighlightOptions = {}) => {
  const lowlight = createLowlight(HIGHLIGHT_LANGUAGES);

  return (tree: HighlightNode) => {
    visit(tree, "element", (node: HighlightNode, _index, parent) => {
      const pre = parent as HighlightNode | undefined;
      if (node.tagName !== "code" || pre?.tagName !== "pre") return;

      const classes = Array.isArray(node.properties?.className)
        ? (node.properties.className as unknown[]).map(String)
        : [];
      if (classes.includes("no-highlight") || classes.includes("nohighlight")) {
        return;
      }
      const lang = classes
        .find((it) => it.startsWith("language-") || it.startsWith("lang-"))
        ?.replace(/^lang(uage)?-/, "");
      if (!lang && !options.detect) return;
      if (lang && options.plainText?.includes(lang)) return;

      node.properties = {
        ...node.properties,
        className: classes.includes("hljs") ? classes : ["hljs", ...classes],
      };
      if (lang && !lowlight.registered(lang)) return;

      const text = toText(node as Parameters<typeof toText>[0], {
        whitespace: "pre",
      });
      const result = lang
        ? lowlight.highlight(lang, text)
        : lowlight.highlightAuto(text);

      if (!lang && result.data?.language) {
        (node.properties.className as string[]).push(
          `language-${result.data.language}`,
        );
      }
      if (result.children.length > 0) {
        node.children = result.children as HighlightNode[];
      }
    });
  };
};
