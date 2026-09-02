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
  /**
   * The per-project number, when the table has one. Quests, folios and
   * directories all do, and it is what an id query pins on.
   */
  shortId?: number;
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
 * `id` is the number an id query asked for (`#42`, or a bare `42`), and a
 * hit carrying that `shortId` is pinned above everything else WHATEVER its
 * kind: someone typing `44` asked for one specific thing, and quest #44,
 * folio #44 and directory #44 are all it, while a folio whose body happens
 * to contain the characters "44" is a coincidence. Without the pin that
 * tie fell through to alphabetical order and the thing asked for came out
 * last. The pin used to be on `kind === "quest"`, which is why folio #44
 * ranked under two folios that merely mentioned 44 (quest #1676).
 *
 * The two ranks are separable on purpose: an exact shortId hit is -1
 * regardless of kind; a quest that merely matched by title is ranked on
 * its title like anything else.
 *
 * Ranking happens across kinds, not within them. The palette groups by
 * kind when it renders, but the grouping must not come from the order the
 * tables were queried in.
 */
export const orderSearchHits = <T extends RankableHit>(
  hits: T[],
  needle: string,
  id: number | undefined,
  limit: number,
): T[] => {
  const rankOf = (hit: T): number =>
    id !== undefined && hit.shortId === id
      ? -1
      : rankSearchHit(hit.title, needle);

  // Copied before sorting — `sort` mutates, and the caller's arrays are
  // the repository results.
  return [...hits]
    .sort((a, b) => {
      const byRank = rankOf(a) - rankOf(b);
      return byRank !== 0 ? byRank : a.title.localeCompare(b.title);
    })
    .slice(0, limit);
};
