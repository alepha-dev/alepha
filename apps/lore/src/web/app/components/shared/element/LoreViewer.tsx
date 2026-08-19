import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import type { ElementRef } from "./elementRef.ts";
import { useElementLinks } from "./useElementLinks.ts";

export interface LoreViewerProps {
  element: ElementRef;
  /** The element's stored markdown, exactly as saved. */
  content: string;
}

/**
 * Read-only markdown for any element, with `[[…]]` resolved to real links.
 *
 * The reader half of the pair `LoreViewer` / `LoreEditor`. Every surface
 * that shows an element's body goes through this, so `[[#42]]`,
 * `[[quest:#N]]`, `[[epic:#N]]` and `[[blob:#N]]` all behave the same
 * whether the reader is looking at a folio, a quest or an epic — they did
 * not before, and the epic description rendered raw `[[…]]` tokens as
 * literal text.
 *
 * Renders nothing for empty content rather than an empty `MarkdownView`;
 * callers own their own "no description yet" copy, which differs per
 * surface.
 */
const LoreViewer = (props: LoreViewerProps) => {
  const { rendered } = useElementLinks(props.element, props.content ?? "");

  if (!props.content) return null;

  return <MarkdownView content={rendered} />;
};

export default LoreViewer;
