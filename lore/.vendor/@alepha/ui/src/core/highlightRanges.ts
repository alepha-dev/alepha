/**
 * Where a search occurs in a text, as sorted, merged `[start, end)` ranges
 * over the ORIGINAL text, ready to slice.
 *
 * Each whitespace-separated term of the query is matched on its own, so
 * "martin cam" marks both "Cam" and "Martin" in "Camille Martin": a server
 * search over "first last" and "last first" returns that row for the reversed
 * query too, and a highlight matching only the whole query would leave it
 * unmarked. Overlapping and touching matches merge into one range.
 *
 * Case and diacritics are ignored on both sides ("lea" marks "Léa", "É"
 * marks "e"). The text is folded one character at a time with a map back to
 * the original index, so a character whose fold changes length (a
 * precomposed letter, a ligature) still maps its match onto the right
 * slice, and a match never ends between a letter and the combining mark that
 * follows it.
 *
 * Plain `indexOf`, not a RegExp built from the query: a search holding `.`,
 * `(` or `*` is text to find, not a pattern.
 */
export const highlightRanges = (
  text: string,
  query: string | undefined,
): Array<[number, number]> => {
  if (!text || !query) return [];
  const terms = query
    .trim()
    .split(/\s+/)
    .map(fold)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return [];

  // `origin[i]` is the index in `text` of the character folded[i] came from.
  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(i) ?? 0);
    const part = fold(char);
    for (let k = 0; k < part.length; k++) origin.push(i);
    folded += part;
    i += char.length;
  }

  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(term, from);
      if (at === -1) break;
      const start = origin[at];
      const last = origin[at + term.length - 1];
      let end = last + String.fromCodePoint(text.codePointAt(last) ?? 0).length;
      while (end < text.length && COMBINING.test(text[end])) end++;
      ranges.push([start, end]);
      from = at + term.length;
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1]) {
      previous[1] = Math.max(previous[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
};

const COMBINING = /\p{M}/u;

const fold = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
