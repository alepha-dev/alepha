import { useI18n } from "alepha/react/i18n";
import type { ReactElement } from "react";

import type { I18n } from "../../../../services/I18n.ts";
import {
  type FolioOutlineHeading,
  markdownOutline,
} from "./markdownOutline.ts";
import {
  type FolioOutlineDomHeading,
  resolveHeadingIndex,
} from "./resolveHeadingIndex.ts";

export interface FolioOutlineTabProps {
  /**
   * The folio's current markdown — the same live buffer the editor shows,
   * so the outline updates as the user types rather than lagging behind
   * the last save.
   */
  content: string;
  /**
   * The editor's contenteditable root (or an ancestor of it), used only to
   * resolve a heading entry to the DOM element to scroll to. `null` before
   * the editor has mounted (create mode's first paint, or while MDXEditor's
   * lazy chunk is still loading) — clicking an entry is simply a no-op
   * until it settles.
   */
  contentElement: HTMLElement | null;
}

/**
 * The Outline tab: a flat, indented list of headings parsed from the raw
 * markdown by `markdownOutline` (Task 2).
 *
 * Navigating a click to the right place in the editor is the part that
 * looks trivial and isn't. The obvious approach —
 * `contentElement.querySelectorAll("h1,…,h6").item(heading.index)` —
 * assumes `markdownOutline`'s regex-based parser and MDXEditor's own
 * CommonMark parser always agree on what counts as a heading. They don't
 * always: a fenced code block whose closing fence is shorter than its
 * opener, or an ATX heading nested inside a list item, can make one side
 * count a heading the other doesn't. The moment that happens, a purely
 * positional lookup silently addresses the WRONG element for every
 * heading after the disagreement — no error, just a click that scrolls to
 * the wrong section.
 *
 * `resolveHeading` below matches on TEXT first (the thing both parsers
 * agree on: the rendered heading's visible words), and falls back to the
 * `index` only to disambiguate two or more headings that are genuinely
 * identical in both level and text — the one case text alone can't
 * resolve on its own. The actual matching rules live in the DOM-free
 * `resolveHeadingIndex` (`resolveHeadingIndex.ts`) so they can be
 * unit-tested without jsdom — see `apps/lore/test/folio-outline-resolve-heading.spec.ts`.
 * This component's own `resolveHeading` is just that pure function plus
 * the DOM query needed to feed it and turn its answer into an `Element`.
 */
const FolioOutlineTab = (props: FolioOutlineTabProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const outline = markdownOutline(props.content);

  /**
   * Resolve an outline entry to its element in the editor's contenteditable.
   * Queries the live DOM, reduces it to the `{level, text}` shape
   * `resolveHeadingIndex` matches against, and turns the returned index
   * back into an `Element` — the matching RULES themselves live in that
   * pure function so they're covered by a node spec, not just this
   * component's own (necessarily DOM-dependent) behavior.
   */
  const resolveHeading = (
    heading: FolioOutlineHeading,
  ): Element | undefined => {
    if (!props.contentElement) return undefined;
    const elements = [
      ...props.contentElement.querySelectorAll("h1, h2, h3, h4, h5, h6"),
    ];
    const domHeadings: FolioOutlineDomHeading[] = elements.map((el) => ({
      level: Number(el.tagName.slice(1)),
      text: el.textContent ?? "",
    }));
    const index = resolveHeadingIndex(outline, heading, domHeadings);
    return index === undefined ? undefined : elements[index];
  };

  const scrollTo = (heading: FolioOutlineHeading) => {
    resolveHeading(heading)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  if (outline.length === 0) {
    return (
      <p className="text-muted-foreground px-3 py-4 text-center text-xs italic">
        {tr("folios.editor.inspector.outline-empty")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col py-1">
      {outline.map((heading) => (
        <li key={heading.index}>
          <button
            type="button"
            onClick={() => scrollTo(heading)}
            style={{ paddingLeft: 10 + (heading.level - 1) * 14 }}
            className="hover:bg-accent/50 flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm text-foreground/85 transition-colors"
          >
            <span className="folio-mono text-muted-foreground w-6 shrink-0 text-[10px] uppercase">
              H{heading.level}
            </span>
            <span className="truncate">{heading.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
};

export default FolioOutlineTab;
