/**
 * Ordering for global search results.
 *
 * A pure module rather than a method on `SearchController`, for the same
 * reason `folioFindMatches` and `folioTreeModel` are pure: this is the
 * part that decides what a user sees first, it is easy to break silently,
 * and testing it through the controller would mean booting the ORM and
 * the whole entity graph to sort an array. There is nothing here to
 * substitute via DI — no I/O, no clock, no repository.
 */

export interface RankableHit {
  kind: string;
  title: string;
}

/**
 * How well a title answers the query. Lower is better.
 *
 * Exact, then prefix, then contained, then everything else — a folio that
 * matched deep in its body rather than in its title lands last.
 */
export const rankSearchHit = (title: string, needle: string): number => {
  const lower = title.toLowerCase();
  if (lower === needle) return 0;
  if (lower.startsWith(needle)) return 1;
  if (lower.includes(needle)) return 2;
  return 3;
};

/**
 * Merge every table's rows into one ordered, capped list.
 *
 * `isIdQuery` pins quests above everything else: someone typing `#42`
 * asked for one specific thing, and a folio whose body happens to contain
 * the characters "#42" is a coincidence. Without the pin that tie fell
 * through to alphabetical order and the exact match came out last.
 *
 * Ranking happens across kinds, not within them. The palette groups by
 * kind when it renders, but the grouping must not come from the order the
 * tables were queried in.
 */
export const orderSearchHits = <T extends RankableHit>(
  hits: T[],
  needle: string,
  isIdQuery: boolean,
  limit: number,
): T[] => {
  const rankOf = (hit: T): number =>
    isIdQuery && hit.kind === "quest" ? -1 : rankSearchHit(hit.title, needle);

  // Copied before sorting — `sort` mutates, and the caller's arrays are
  // the repository results.
  return [...hits]
    .sort((a, b) => {
      const byRank = rankOf(a) - rankOf(b);
      return byRank !== 0 ? byRank : a.title.localeCompare(b.title);
    })
    .slice(0, limit);
};
