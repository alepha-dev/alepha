import type { FolioOutlineHeading } from "./markdownOutline.ts";

/**
 * One heading as it actually exists somewhere to match against — the
 * editor's rendered `h1..h6` elements, reduced to just `level`/`text`, or
 * (in tests) a plain DOM-free stand-in for the same shape.
 */
export interface FolioOutlineDomHeading {
  level: number;
  text: string;
}

/**
 * Resolve an outline entry to the INDEX of its matching heading among
 * `domHeadings` — pure and DOM-free, extracted out of `FolioOutlineTab`
 * so the matching RULES (not just the happy-path click) can be unit-tested
 * without jsdom, as a plain node spec that runs under the root `yarn test`
 * command CI uses.
 *
 * Text (+ level) is the reliable key: `markdownOutline`'s regex parser and
 * MDXEditor's own CommonMark parser can disagree on what counts as a
 * heading (a fenced block whose closing fence is shorter than its opener,
 * an ATX heading nested inside a list item) — any such disagreement makes
 * a purely positional lookup silently address the wrong element, with no
 * error, for every heading after the disagreement. `heading.index` is
 * used only as:
 * - a tie-breaker when the same text+level repeats more than once (rank
 *   among the outline's own duplicates, matched against rank among the
 *   DOM's duplicates), and
 * - a last-resort fallback when NO text match exists at all (the genuine
 *   parser-disagreement case) — which is only safe when that index is
 *   still in range. An outline entry the DOM has no counterpart for at
 *   all (a `domHeadings` list shorter than the outline, or empty — e.g.
 *   the editor hasn't mounted, or source mode) resolves to `undefined`:
 *   no scroll, never a WRONG scroll.
 */
export const resolveHeadingIndex = (
  outline: FolioOutlineHeading[],
  heading: FolioOutlineHeading,
  domHeadings: FolioOutlineDomHeading[],
): number | undefined => {
  const wanted = heading.text.trim().toLowerCase();
  const matchIndexes: number[] = [];
  for (let i = 0; i < domHeadings.length; i++) {
    const dom = domHeadings[i];
    if (
      dom.level === heading.level &&
      dom.text.trim().toLowerCase() === wanted
    ) {
      matchIndexes.push(i);
    }
  }
  if (matchIndexes.length === 1) return matchIndexes[0];
  if (matchIndexes.length > 1) {
    // Repeated heading: pick the occurrence whose rank among duplicates
    // matches this entry's rank in the outline.
    const rank = outline
      .filter((h) => h.level === heading.level && h.text === heading.text)
      .findIndex((h) => h.index === heading.index);
    return matchIndexes[rank] ?? matchIndexes[0];
  }
  return heading.index < domHeadings.length ? heading.index : undefined;
};
