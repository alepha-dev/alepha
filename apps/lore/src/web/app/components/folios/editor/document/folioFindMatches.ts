/**
 * A hit, as a half-open offset range into the document's concatenated
 * text content. `useFolioFind` maps these back onto DOM text nodes to
 * build the `Range` objects the CSS Custom Highlight API consumes.
 */
export interface FolioFindMatch {
  start: number;
  end: number;
}

/**
 * Case-insensitive literal substring search over the document text.
 *
 * Deliberately not a regex over user input — a folio about regular
 * expressions would otherwise turn its own body into a pattern. Matches
 * are non-overlapping and scanned left to right, so `"aa"` in `"aaaa"`
 * yields two hits rather than three.
 */
export const folioFindMatches = (
  haystack: string,
  needle: string,
): FolioFindMatch[] => {
  if (!needle || !haystack) return [];
  const hay = haystack.toLowerCase();
  const pin = needle.toLowerCase();
  const matches: FolioFindMatch[] = [];
  let from = 0;
  while (from <= hay.length - pin.length) {
    const at = hay.indexOf(pin, from);
    if (at === -1) break;
    matches.push({ start: at, end: at + pin.length });
    from = at + pin.length;
  }
  return matches;
};

/**
 * Move the active match cursor, wrapping at both ends. Returns 0 when
 * there is nothing to step through, so the caller never indexes an empty
 * list.
 */
export const stepFolioMatch = (
  count: number,
  current: number,
  direction: 1 | -1,
): number => {
  if (count <= 0) return 0;
  return (current + direction + count) % count;
};
