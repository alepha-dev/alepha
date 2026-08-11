import type { ProjectNavEntry } from "../../../atoms/projectNavAtom.ts";

/**
 * How many page/app rows may precede the content groups. Six covers every
 * sidebar entry a project has today without content — what most searches are
 * actually for — ever being pushed out of view.
 */
export const MAX_NAV_MATCHES = 6;

/**
 * Pick the pages and apps a query should offer, best first.
 *
 * Matched in the browser rather than on the server because they never left it:
 * `projectNavAtom` holds the sidebar's own computed nav, so the candidate list
 * is already exactly what is reachable in this project right now.
 *
 * **Ranking is earliest-match-first, then shortest label.** Typing "fol" should
 * offer *Folios* before an app called *portfolio* — the first because the match
 * starts at 0, and between two equal starts the shorter label is the more
 * specific answer. Deliberately not a fuzzy score: page labels are one or two
 * words, so anything cleverer would be tuning noise.
 */
export const matchProjectNav = (
  entries: ProjectNavEntry[] | undefined,
  query: string,
  max: number = MAX_NAV_MATCHES,
): ProjectNavEntry[] => {
  const q = query.trim().toLowerCase();
  if (!q || !entries?.length) return [];
  return entries
    .map((entry) => ({ entry, at: entry.label.toLowerCase().indexOf(q) }))
    .filter((it) => it.at >= 0)
    .sort((a, b) => a.at - b.at || a.entry.label.length - b.entry.label.length)
    .slice(0, max)
    .map((it) => it.entry);
};
