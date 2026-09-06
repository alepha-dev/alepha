import * as React from "react";

void React;

import "./markdown-view.css";
import { lazy, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { DiagramErrorBoundary } from "./diagram/DiagramErrorBoundary.tsx";
import { remarkSpoiler } from "./remarkSpoiler.ts";
import { SpoilerSpan } from "./SpoilerSpan.tsx";

/**
 * Both parsers, both layouts (`graphre` for the flowchart, arithmetic for
 * the sequence diagram) and both emitters, pulled in ONLY when a document
 * actually contains a mermaid fence.
 *
 * This is the constraint the whole diagram layer exists under: a document
 * with no diagram must pay nothing at all. One with a diagram pays one
 * chunk once, then it is cached. Measured on 2026-08-28 with both diagram
 * types in it: 64.5 kB raw, **22.2 kB gzip**, 19.4 kB brotli - against
 * 17.95 kB gzip when it drew flowcharts only. If it ever passes ~26 kB,
 * split the two pipelines into two chunks so a flowchart-only document
 * stops paying for the sequence one.
 *
 * ⚠️ A lazy import a bundler decides to inline fails silently: the feature
 * still works and the cost moves into the entry chunk. After changing this,
 * build and confirm the diagram code is in a chunk of its own and the entry
 * has none of it:
 *
 *     yarn w lore build
 *     grep -rl 'addBorderSegments\|sequenceDiagram' apps/lore/dist/public/
 */
const MermaidFence = lazy(() => import("./diagram/MermaidFence.tsx"));

export interface MarkdownViewProps {
  content: string;
  /**
   * Extra classes for the prose root, merged after the defaults so a caller
   * can set its own reading face or measure. The defaults it overrides are
   * `text-sm leading-relaxed` — a surface that sets prose in a display serif
   * needs both, and no parent wrapper can supply them, since they sit on
   * this element rather than being inherited.
   */
  className?: string;
}

/**
 * Renders markdown as formatted prose.
 *
 * ## Diagrams
 *
 * A ` ```mermaid ` fence containing a **`flowchart`** or a
 * **`sequenceDiagram`** is drawn as an SVG diagram instead of a code block,
 * themed from the app's own CSS variables so dark mode needs no second
 * palette. The renderer is in-house: only flowchart layout is imported
 * (`graphre`, dagre in TypeScript, ~15.5 kB gzip), and the whole thing is
 * one lazy chunk pulled in only when a document actually contains a fence,
 * so a document with no diagram pays nothing.
 *
 * The flowchart subset is `flowchart TD|TB|LR|RL|BT`; the four node shapes
 * `[rect]` `(rounded)` `{diamond}` `((circle))`, with every other mermaid
 * bracket pair consumed and mapped onto them; edges `-->` `---` `-.->`
 * `==>` `<-->` with labels in both the `-->|text|` and `-- text -->` forms;
 * chains, `&` fans, `<br/>` line breaks and nested `subgraph`.
 *
 * The sequence subset is participants and actors, the eight arrow forms,
 * notes, `autonumber`, self-messages and the `alt` / `else` / `opt` /
 * `loop` fragment boxes. Activation bars are ignored. A wide sequence
 * diagram keeps its natural size in a scroll frame rather than shrinking
 * into the prose column.
 *
 * **Everything else degrades to the code block, silently.**
 * `classDiagram`, `gantt` and mindmaps are not drawn, `style` / `classDef`
 * are ignored, and a parse failure, a refused construct or a diagram past
 * its cap renders the plain fence rather than an error. Agents write
 * invalid mermaid, and a red box in the middle of a document is worse than
 * a grey fence. See `packages/@alepha/ui/DOC.md` for the full table.
 *
 * ## Spoilers
 *
 * `||text||` renders as a covered box that reveals on click, on Enter or on
 * Space, Discord's syntax and Discord's behaviour. Inline markdown inside it
 * survives, a code span or a fence keeps its pipes literally, and an
 * unterminated `||` renders as the two characters the author typed rather
 * than swallowing the rest of the paragraph.
 *
 * ⚠️ **It is not a security feature.** The text is in the DOM from the first
 * paint, in the raw markdown, in an export, over MCP and in any search
 * snippet. It hides a plot point from a reader's eye and nothing more.
 *
 * ## Raw HTML
 *
 * No raw HTML is ever rendered as markup: react-markdown's default is to
 * escape a raw node to text, and this component deliberately mounts no
 * plugin that changes that. A narrow `rehypeSafeImg` plugin used to promote
 * a lone `<img …>` — the one thing MDXEditor emitted for a *resized* image —
 * and was deleted along with the editor that produced it, since nothing
 * writes that markup anymore.
 *
 * Do not reach for `rehype-raw` to bring the capability back: this renders
 * content authored by one user to another, so every raw tag becoming live
 * markup turns every markdown surface in every app into an injection point.
 */
export const MarkdownView = (props: MarkdownViewProps) => {
  return (
    <div
      // `data-slot`, matching every other block here, so a host page can
      // reach the prose root without a wrapper class. Lore's folio
      // document uses it to make this inherit the reading size instead
      // of the `text-sm` default below.
      data-slot="markdown-view"
      className={`max-w-none text-sm leading-relaxed ${props.className ?? ""}`}
    >
      <ReactMarkdown
        // ⚠️ `remarkSpoiler` runs AFTER `remarkGfm`, and the order is
        // load-bearing: by then a `| a | b |` row is a table with cells, so
        // the pipes are structure and the spoiler walk never sees them as
        // text. Reversed, every two-column table would be a spoiler.
        remarkPlugins={[remarkGfm, remarkSpoiler]}
        rehypePlugins={[
          // `plainText` claims the fence BEFORE highlighting runs: hljs would
          // otherwise tokenise the diagram source, and the fallback would be a
          // soup of spans instead of the text the author wrote.
          //
          // `ignoreMissing` is gone: it no longer exists in v7, where an
          // unknown language already produces a vfile message rather than a
          // throw.
          [rehypeHighlight, { detect: true, plainText: ["mermaid"] }],
        ]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 mb-3 text-2xl font-semibold tracking-tight">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-6 mb-2 text-xl font-semibold tracking-tight">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-4 mb-2 text-base font-semibold">{children}</h3>
          ),
          p: ({ children }) => <p className="my-3">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-primary decoration-primary/50 hover:decoration-primary underline underline-offset-4"
            >
              {children}
            </a>
          ),
          code: ({ children, className }) => {
            const isBlock =
              className?.includes("language-") || className?.includes("hljs");
            if (isBlock) {
              return <code className={`${className} text-xs`}>{children}</code>;
            }
            return (
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[0.85em]">
                {children}
              </code>
            );
          },
          pre: ({ children, node }) => {
            const block = (
              <pre className="border-border my-4 overflow-auto rounded-md border bg-transparent p-3 text-xs">
                {children}
              </pre>
            );
            const source = mermaidSource(node);
            if (!source) return block;
            return (
              <DiagramErrorBoundary fallback={block}>
                {/*
                  The loading state IS the code block: the fence is already on
                  screen, and swapping it for the diagram when the chunk lands
                  costs no spinner and no second layout.
                */}
                <Suspense fallback={block}>
                  <MermaidFence source={source} fallback={block} />
                </Suspense>
              </DiagramErrorBoundary>
            );
          },
          // The only `<span>` this renderer ever produces is a spoiler's, and
          // the only thing that marks one is the `data-spoiler` property
          // `remarkSpoiler` puts there.
          //
          // ⚠️ The cast is not laziness: react-markdown types a span's props
          // as `HTMLAttributes<HTMLSpanElement>`, which PERMITS writing a
          // `data-*` attribute in JSX and does not declare one for reading.
          // The alternative - a custom `hName` with its own `components` key -
          // needs a cast into `components`, whose type is keyed on intrinsic
          // elements, so it buys nothing (the same note `mermaidSource`
          // already carries).
          span: ({ children, ...rest }) => {
            const marked = (rest as { "data-spoiler"?: unknown })[
              "data-spoiler"
            ];
            if (marked) return <SpoilerSpan>{children}</SpoilerSpan>;
            return <span {...rest}>{children}</span>;
          },
          blockquote: ({ children }) => (
            <blockquote className="border-muted-foreground/30 my-3 border-l-2 pl-4 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border my-6" />,
          table: ({ children }) => (
            <table className="my-4 border-collapse text-xs">{children}</table>
          ),
          th: ({ children }) => (
            <th className="border-border border px-2 py-1 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-border border px-2 py-1">{children}</td>
          ),
        }}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  );
};

/**
 * The text of a ` ```mermaid ` fence, or `undefined` for every other `<pre>`.
 *
 * Reads the hast node rather than the rendered children because the source
 * has to arrive at the parser exactly as the author typed it, and walking React
 * children would mean reassembling it from whatever the renderer produced.
 *
 * The alternative wiring, a remark plugin, is more code for the same result:
 * `mdast-util-to-hast` applies `data.hName` to the `<code>` element BEFORE
 * wrapping it in `<pre>`, so renaming the code node still leaves the diagram
 * inside this bordered box. Going that way needs a custom node type and a
 * cast into `components`, whose type is keyed on intrinsic elements.
 */
const mermaidSource = (node: unknown): string | undefined => {
  const pre = node as
    | {
        children?: Array<{
          type?: string;
          tagName?: string;
          properties?: { className?: unknown };
          children?: Array<{ type?: string; value?: string }>;
        }>;
      }
    | undefined;
  const code = pre?.children?.[0];
  if (code?.type !== "element" || code.tagName !== "code") return undefined;

  const className = code.properties?.className;
  const names = Array.isArray(className)
    ? className.map(String)
    : typeof className === "string"
      ? className.split(/\s+/)
      : [];
  if (!names.includes("language-mermaid")) return undefined;

  const text = code.children
    ?.filter((child) => child.type === "text")
    .map((child) => child.value ?? "")
    .join("");
  return text?.trim() ? text : undefined;
};
