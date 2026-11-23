import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { MarkdownView } from "@alepha/ui/markdown";
import { Link } from "alepha/react/router";

import {
  codeHref,
  codeRawHref,
  dirnameOf,
  resolveCodeLink,
} from "./codeHref.ts";

export interface CodeMarkdownProps {
  text: string;
  /**
   * The Markdown file's own path, which relative links resolve against.
   */
  path: string;
  projectId: number;
  projectSlug: string;
  repoSlug: string;
  /**
   * The revision links stay on, as the reader picked it.
   */
  revision: string;
  /**
   * The commit images are read at.
   */
  sha: string;
}

/**
 * A repository's Markdown (#Q4134), through `MarkdownView` itself and never
 * `LoreViewer`, which would read `[[...]]` as Lore references. A relative
 * link opens the file or folder at the same revision; a relative image is
 * the raw file at the commit; anything else leaves as written.
 */
const CodeMarkdown = (props: CodeMarkdownProps) => {
  const base = dirnameOf(props.path);
  return (
    <MarkdownView
      content={props.text}
      renderLink={({ href, children }) => {
        const target = resolveCodeLink(base, href);
        if (!target) {
          return (
            <a
              href={href}
              rel="noopener noreferrer nofollow"
              className={cn(
                "hover:text-foreground font-medium",
                textLinkUnderlineClassName,
              )}
            >
              {children}
            </a>
          );
        }
        return (
          <Link
            href={`${codeHref(
              target.folder ? "tree" : "blob",
              props.projectSlug,
              props.repoSlug,
              props.revision,
              target.path,
            )}${target.hash}`}
            className={cn(
              "hover:text-foreground font-medium",
              textLinkUnderlineClassName,
            )}
          >
            {children}
          </Link>
        );
      }}
      renderImage={({ src, alt, title }) => {
        const target = resolveCodeLink(base, src);
        return (
          <img
            src={
              target
                ? codeRawHref(
                    props.projectId,
                    props.repoSlug,
                    props.sha,
                    target.path,
                  )
                : src
            }
            alt={alt}
            title={title}
            className="max-w-full"
          />
        );
      }}
    />
  );
};

export default CodeMarkdown;
