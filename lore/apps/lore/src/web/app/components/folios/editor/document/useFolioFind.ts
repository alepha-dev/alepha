import { useCallback, useEffect, useRef, useState } from "react";
import { folioFindMatches, stepFolioMatch } from "./folioFindMatches.ts";

/**
 * The find bar's whole surface — state plus the four commands the bar and
 * Edit▸Find drive it with. `show` is what `useFolioActions`'s `edit.find`
 * handler (and ⌘F through it) calls.
 */
export interface FolioFindState {
  open: boolean;
  query: string;
  total: number;
  /**
   * Zero-based index of the active match. The bar displays `active + 1`.
   */
  active: number;
  setQuery: (q: string) => void;
  next: () => void;
  previous: () => void;
  close: () => void;
  show: () => void;
}

/**
 * One text node of the document pane, with the offset at which its text
 * starts inside the pane's concatenated text content. `folioFindMatches`
 * works on that concatenation, so every hit has to be mapped back through
 * these entries to the `(node, offset)` pairs a `Range` is built from.
 */
interface FolioFindTextNode {
  node: Text;
  start: number;
}

const HIGHLIGHT_ALL = "folio-find";
const HIGHLIGHT_ACTIVE = "folio-find-active";

/**
 * Whether the CSS Custom Highlight API is usable in this browser. Guarded
 * for jsdom too, where `CSS` exists but `CSS.highlights` does not — the
 * browser test environment must not throw on a hook that merely renders.
 */
const supportsHighlights = (): boolean =>
  typeof CSS !== "undefined" &&
  "highlights" in CSS &&
  typeof (window as unknown as { Highlight?: unknown }).Highlight ===
    "function";

const clearHighlights = (): void => {
  if (!supportsHighlights()) return;
  CSS.highlights.delete(HIGHLIGHT_ALL);
  CSS.highlights.delete(HIGHLIGHT_ACTIVE);
};

/**
 * Walk the pane's text nodes in document order, concatenating their text
 * and recording where each one starts. Attribute values, element names and
 * anything else non-textual are invisible to this, which is what makes the
 * search match what the reader actually sees rather than the markup.
 *
 * Form controls are skipped. The title and summary fields sit in the same
 * scroll container as the prose, and a `<textarea>` carries its value as a
 * real text node — so without this they join the match list. That is not a
 * cosmetic count problem: the CSS Custom Highlight API cannot paint inside
 * a form control's rendered value, so such a hit would advance the counter
 * to a match nothing on screen ever highlights. Find-in-folio searches the
 * folio, and the title is not part of it. (The title was an `<input>` when
 * this was written, which hid the question — an input's value is not a text
 * node at all — and made it look handled when nothing handled it.)
 */
const collectTextNodes = (
  root: HTMLElement,
): { text: string; entries: FolioFindTextNode[] } => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      (node.parentElement as HTMLElement | null)?.closest(
        "textarea, input, select",
      )
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const entries: FolioFindTextNode[] = [];
  let text = "";

  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    if (textNode.data.length > 0) {
      entries.push({ node: textNode, start: text.length });
      text += textNode.data;
    }
    node = walker.nextNode();
  }

  return { text, entries };
};

/**
 * Resolve a document-wide offset to the text node containing it. `from` is
 * the index to start scanning at: matches arrive sorted, so the caller
 * carries the previous hit's node index forward and the whole mapping stays
 * linear instead of re-scanning the document once per match.
 *
 * The half-open comparison (`offset < start + length`) means an offset
 * landing exactly on a node boundary resolves to the FOLLOWING node, which
 * is what a range start wants. A range END on a boundary would rather point
 * at the end of the previous node, hence `resolveEnd` below.
 */
const resolveStart = (
  entries: FolioFindTextNode[],
  offset: number,
  from: number,
): number => {
  for (let i = from; i < entries.length; i++) {
    const entry = entries[i];
    if (offset < entry.start + entry.node.data.length) return i;
  }
  return -1;
};

const resolveEnd = (
  entries: FolioFindTextNode[],
  offset: number,
  from: number,
): number => {
  for (let i = from; i < entries.length; i++) {
    const entry = entries[i];
    if (offset <= entry.start + entry.node.data.length) return i;
  }
  return -1;
};

/**
 * Build one `Range` per match. A match may span several text nodes — bold
 * or a link inside the searched phrase splits it — so start and end are
 * resolved independently rather than assuming one node holds both.
 */
const buildRanges = (
  entries: FolioFindTextNode[],
  text: string,
  query: string,
): Range[] => {
  const ranges: Range[] = [];
  let cursor = 0;

  for (const match of folioFindMatches(text, query)) {
    const startIndex = resolveStart(entries, match.start, cursor);
    if (startIndex === -1) break;
    const endIndex = resolveEnd(entries, match.end, startIndex);
    if (endIndex === -1) break;
    cursor = startIndex;

    const startEntry = entries[startIndex];
    const endEntry = entries[endIndex];
    const range = document.createRange();
    range.setStart(startEntry.node, match.start - startEntry.start);
    range.setEnd(endEntry.node, match.end - endEntry.start);
    ranges.push(range);
  }

  return ranges;
};

/**
 * Find-in-folio over the rendered document pane (Edit▸Find, ⌘F).
 *
 * Searches the DOM the reader sees rather than the markdown source, so a
 * hit can be highlighted where it actually is. Highlighting goes through
 * the CSS Custom Highlight API (`::highlight(folio-find)` in `main.css`)
 * precisely BECAUSE it paints without touching the DOM: wrapping hits in
 * `<mark>` elements inside the editor's `contenteditable` would corrupt
 * Lexical's document state, and the user would find those marks saved into
 * their folio. Browsers without the API still get scroll-to-match, just
 * unhighlighted — a degraded find is better than a corrupted document.
 *
 * `contentElement` is the document pane's scroll container, the same
 * element the inspector's Outline tab scrolls headings within.
 *
 * `content` is the draft's markdown — not searched (the DOM is), only
 * watched: the bar stays open while the user keeps typing, and every
 * `Range` held here points into text nodes an edit can move or destroy.
 * Recomputing when the document changes is what keeps the highlights on
 * the words they claim to be on.
 */
export const useFolioFind = (
  contentElement: HTMLElement | null,
  content: string,
): FolioFindState => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(0);
  const rangeCountRef = useRef(0);

  useEffect(() => {
    if (!open || !contentElement || !query.trim()) {
      clearHighlights();
      rangeCountRef.current = 0;
      setTotal(0);
      return;
    }

    const { text, entries } = collectTextNodes(contentElement);
    const ranges = buildRanges(entries, text, query);
    rangeCountRef.current = ranges.length;
    setTotal(ranges.length);

    if (ranges.length === 0) {
      clearHighlights();
      return;
    }

    // The query can shrink the match list under a cursor that was valid a
    // keystroke ago; clamping here rather than in `setQuery` keeps every
    // path (typing, editing the body, reopening the bar) covered by one
    // rule. The state update re-runs this effect with the clamped value.
    if (active >= ranges.length) {
      setActive(0);
      return;
    }

    const activeRange = ranges[active];
    activeRange.startContainer.parentElement?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    if (!supportsHighlights()) return;

    const HighlightCtor = (window as unknown as { Highlight: typeof Highlight })
      .Highlight;
    const all = new HighlightCtor(...ranges);
    const current = new HighlightCtor(activeRange);
    // Both layers cover the active range, so one of them has to win.
    // Priority defaults to 0 on both, and the tie left the active match
    // painted over by the dimmer "all" layer — the match you were standing
    // on looked like every other match. An explicit priority settles it
    // regardless of registration order.
    current.priority = 1;
    CSS.highlights.set(HIGHLIGHT_ALL, all);
    CSS.highlights.set(HIGHLIGHT_ACTIVE, current);
  }, [contentElement, query, open, active, content]);

  // A highlight registered on `CSS.highlights` is global to the document,
  // not scoped to this component — leaving one behind paints stale ranges
  // over whatever the user navigates to next.
  useEffect(() => clearHighlights, []);

  const show = useCallback(() => setOpen(true), []);

  const close = useCallback(() => {
    setOpen(false);
    clearHighlights();
  }, []);

  const next = useCallback(() => {
    setActive((current) => stepFolioMatch(rangeCountRef.current, current, 1));
  }, []);

  const previous = useCallback(() => {
    setActive((current) => stepFolioMatch(rangeCountRef.current, current, -1));
  }, []);

  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    setActive(0);
  }, []);

  return {
    open,
    query,
    total,
    active,
    setQuery: updateQuery,
    next,
    previous,
    close,
    show,
  };
};
