import { loreDocsUrl } from "@lore/core/web";
import { useRouter } from "alepha/react/router";
import type { ReactNode } from "react";

export interface AssistantReplyLinkProps {
  href?: string;
  children: ReactNode;
}

/**
 * A link in an assistant reply (#Q3211). The model writes the text, so a
 * link is trusted only as far as it can be checked:
 *
 * - a path the router resolves to one of Lore's pages (`router.matches`,
 *   the router's own matching, not a pattern) navigates in-app, which in the
 *   dock changes the page beside the conversation;
 * - a page of Lore's guides opens on the docs site, in a new tab;
 * - anything else renders as its text, unlinked.
 */
const AssistantReplyLink = (props: AssistantReplyLinkProps) => {
  const router = useRouter<any>();
  const href = props.href ?? "";

  if (href.startsWith(AssistantReplyLink.docsRoot)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {props.children}
      </a>
    );
  }
  if (href.startsWith("/") && !href.startsWith("//") && router.matches(href)) {
    return (
      <a {...router.anchor(href as `/${string}`)} data-testid="assistant-link">
        {props.children}
      </a>
    );
  }
  return <span>{props.children}</span>;
};

/**
 * Where Lore's guides live, read off the one helper every docs link goes
 * through, so the two cannot disagree.
 */
AssistantReplyLink.docsRoot = loreDocsUrl("agents-assistant").replace(
  /agents-assistant$/,
  "",
);

export default AssistantReplyLink;
