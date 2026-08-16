import * as React from "react";

void React;

import "./markdown-view.css";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

export interface MarkdownViewProps {
  content: string;
}

/**
 * Renders markdown as formatted prose.
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
    <div className="max-w-none text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
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
              className="text-primary underline decoration-primary/50 underline-offset-4 hover:decoration-primary"
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
              <code className="bg-muted rounded px-1.5 py-0.5 text-[0.85em] font-mono">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="border-border my-4 overflow-auto rounded-md border bg-transparent p-3 text-xs">
              {children}
            </pre>
          ),
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
