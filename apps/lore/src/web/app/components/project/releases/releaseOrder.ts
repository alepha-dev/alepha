/**
 * One ordering for release tags, used by every surface that sorts them.
 *
 * ⚠️ **Never sort a tag as text.** `["0.9.0", "0.28.0"].sort()` yields
 * `0.28.0` first, because `2` precedes `9`. That half of the old warning is
 * still true and is why this file exists.
 *
 * What changed on 2026-08-31 (quest #1640) is the answer to it. Both tables
 * used to sort on the release's `number` instead, described as "the creation
 * sequence, which for releases IS version order". It is not: `number` is a
 * `$sequence`, so it only tracks version order while releases happen to be
 * created in it. Planning `1.0.0` before `0.29.0` breaks the proxy, and one
 * project had already done exactly that, so the Releases table read
 * `0.28.0, 1.0.0, 0.29.0` under a header claiming ascending.
 *
 * The tag is parsed instead. `number` stays, as the tiebreak.
 */

/**
 * A tag's numeric core and its prerelease suffix, or `undefined` when the tag
 * is not version-shaped at all.
 *
 * Version-shaped means an optional `v`, then digits, then any number of
 * dot-separated digit groups, then optionally a `-` or `+` and anything.
 * `demo-1` is deliberately NOT version-shaped: pulling the digits out of it
 * would sort it as version 1, in among the real `1.x` releases. Tags need not
 * be versions at all - the New Release hint says so - so a tag that is not one
 * gets a defined place rather than a wrong number.
 */
interface ReleaseTagParts {
  core: number[];
  pre?: string;
}

const VERSION_TAG = /^[vV]?(\d+(?:\.\d+)*)(?:[-+](.+))?$/;

const parseReleaseTag = (tag: string): ReleaseTagParts | undefined => {
  const match = VERSION_TAG.exec(tag.trim());
  if (!match) return undefined;
  return {
    core: match[1].split(".").map(Number),
    pre: match[2],
  };
};

/**
 * Total order over two release tags.
 *
 * - Version-shaped tags compare numerically, segment by segment. A missing
 *   segment reads as `0`, so `1.0` and `1.0.0` are the same version and
 *   `1.0` precedes `1.0.1`.
 * - A prerelease precedes its own release (`1.0.0-rc.1` before `1.0.0`), and
 *   two prereleases of the same core compare with a numeric-aware collation
 *   so `rc.2` precedes `rc.10`.
 * - A tag that is not version-shaped sorts AFTER every one that is, and those
 *   compare against each other by the same collation. Ascending therefore
 *   reads as the version history followed by the named tags, and flipping the
 *   arrow reverses the whole thing - unlike the "no release" case on the
 *   Epics list, which stays last in both directions because it is an absent
 *   value rather than a value that sorts late.
 *
 * Returns 0 for tags this cannot separate, which is what leaves the caller's
 * `number` tiebreak in charge.
 */
export const compareReleaseTags = (
  a: string | undefined,
  b: string | undefined,
): number => {
  // `releases.tag` is nullable at the column and required on the way in, so a
  // missing tag is only reachable by a direct write. It sorts last rather
  // than throwing: an ordering is not the place to discover that.
  const ta = a?.trim() ?? "";
  const tb = b?.trim() ?? "";
  if (!ta || !tb) {
    if (!ta && !tb) return 0;
    return ta ? -1 : 1;
  }

  const left = parseReleaseTag(ta);
  const right = parseReleaseTag(tb);

  if (!left || !right) {
    if (!left && !right) return collate(ta, tb);
    return left ? -1 : 1;
  }

  const depth = Math.max(left.core.length, right.core.length);
  for (let i = 0; i < depth; i++) {
    const delta = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }

  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return collate(left.pre, right.pre);
};

/**
 * Numeric-aware, case-insensitive comparison, so `rc.2` precedes `rc.10` and
 * `demo-2` precedes `demo-10`. Locale-independent (`en`) because this is an
 * ordering the app owns, not one the reader's locale should move.
 */
const collate = (a: string, b: string): number =>
  a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
