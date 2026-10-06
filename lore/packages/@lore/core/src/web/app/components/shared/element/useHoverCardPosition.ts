import { useEffect, useReducer } from "react";

export interface HoverCardPosition {
  /**
   * Viewport pixels, for a `position: fixed` card.
   */
  top: number;
  left: number;
}

/**
 * Where the wiki-link hover card sits: 8px below its link, kept there while
 * anything scrolls (#Q2354).
 *
 * The card is `position: fixed`, so it is not clipped by the folio pane's
 * `overflow` and it escapes the prose measure. It used to read its link's
 * rect once per render, on purpose ("so it stays put on scroll until the
 * hover ends"), which left it pinned over whatever scrolled under it while
 * its link travelled away. The owner reversed that: the card belongs to its
 * link.
 *
 * So the rect is read on every render, and a scroll anywhere (a capture
 * listener on `window`, since the folio pane is its own scroll container and
 * its `scroll` event does not bubble) or a resize re-renders the card. A link
 * that is no longer visible, scrolled out of any clipping ancestor or out of
 * the viewport, or no longer in the document at all, calls `onHidden`
 * instead: a card pinned to the pane's edge over a link nobody can see is the
 * same complaint.
 *
 * Reading the rect during render rather than holding it in state is what
 * keeps a move between two links to the same target right: the card is keyed
 * by target, so it stays mounted and the next render simply reads the new
 * anchor.
 */
export const useHoverCardPosition = (
  anchor: HTMLElement,
  onHidden: () => void,
): HoverCardPosition => {
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const follow = () => {
      if (!isAnchorVisible(anchor)) {
        onHidden();
        return;
      }
      rerender();
    };
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow, { passive: true });
    return () => {
      window.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
    };
  }, [anchor, onHidden]);

  const rect = anchor.getBoundingClientRect();
  return {
    top: rect.bottom + 8,
    left: Math.max(
      8,
      Math.min(
        rect.left,
        (typeof window !== "undefined" ? window.innerWidth : 1000) - 380,
      ),
    ),
  };
};

/**
 * Whether any of the anchor is on screen: inside the viewport and inside
 * every ancestor that clips its overflow. Touching an edge counts as gone,
 * since a zero-height sliver is nothing to point at.
 */
const isAnchorVisible = (anchor: HTMLElement): boolean => {
  if (!anchor.isConnected) return false;
  const rect = anchor.getBoundingClientRect();
  if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
  for (let el = anchor.parentElement; el; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    if (style.overflowX === "visible" && style.overflowY === "visible") {
      continue;
    }
    const box = el.getBoundingClientRect();
    if (
      rect.bottom <= box.top ||
      rect.top >= box.bottom ||
      rect.right <= box.left ||
      rect.left >= box.right
    ) {
      return false;
    }
  }
  return true;
};
