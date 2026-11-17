import { compareReleaseTags } from "@lore/plan/schemas";

/**
 * The fields of a release this module reads to place a run (#E153).
 */
export interface RunReleaseRow {
  id: number;
  number: number;
  tag?: string;
  title: string;
  releasedAt?: string;
  defaultSince?: string;
}

/**
 * Releases in the order the release list uses: by tag, then by number.
 */
export const orderReleases = <T extends RunReleaseRow>(rows: T[]): T[] =>
  [...rows].sort(
    (a, b) => compareReleaseTags(a.tag, b.tag) || a.number - b.number,
  );

/**
 * The project's current release: the default one when it is open, else the
 * first open one in order. Undefined when every release is published.
 */
export const currentReleaseOf = <T extends RunReleaseRow>(
  ordered: T[],
): T | undefined =>
  ordered.find((it) => it.defaultSince && !it.releasedAt) ??
  ordered.find((it) => !it.releasedAt);

/**
 * The release a run belongs to: the first release published at or after it
 * ran. A run after the last publication belongs to the current release
 * (undefined when there is none, which every caller reads as "current").
 */
export const releaseOfRun = <T extends RunReleaseRow>(
  ordered: T[],
  ranAt: string,
): T | undefined => {
  const published = ordered
    .filter((it) => it.releasedAt && it.releasedAt >= ranAt)
    .sort((a, b) => (a.releasedAt ?? "").localeCompare(b.releasedAt ?? ""));
  return published[0] ?? currentReleaseOf(ordered);
};

/**
 * The releases whose evidence retention keeps: the current release and the
 * three before it, by the release list's order. A run tied to no release
 * belongs to the current one and is always kept.
 */
export const retainedReleaseIds = (
  ordered: RunReleaseRow[],
  window = 3,
): Set<number> => {
  const current = currentReleaseOf(ordered);
  const index = current ? ordered.indexOf(current) : ordered.length;
  return new Set(
    ordered.slice(Math.max(0, index - window), index + 1).map((it) => it.id),
  );
};
