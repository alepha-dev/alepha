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
 * expressions would otherwise turn its own body into a pattern. The needle
 * is escaped so it is always literal text: a needle of `a.c` matches the
 * three characters, not a regex dot. Matches are non-overlapping and
 * scanned left to right, so `"aa"` in `"aaaa"` yields two hits rather
 * than three.
 *
 * Returns offsets into the ORIGINAL haystack (not case-folded), so they
 * map correctly onto DOM text nodes even for characters that change length
 * when lowercased (like İ/U+0130 → i̇).
 */
export const folioFindMatches = (
  haystack: string,
  needle: string,
): FolioFindMatch[] => {
  if (!needle || !haystack) return [];

  // Escape regex special characters so the needle is treated as literal text,
  // not a regex pattern.
  const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Case-insensitive search against the original string. The `g` flag and
  // `exec()` loop handle non-overlapping matches; regex.lastIndex advances
  // automatically after each match.
  const regex = new RegExp(escapedNeedle, "gi");
  const matches: FolioFindMatch[] = [];

  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop pattern
  while ((match = regex.exec(haystack)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
    });
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
