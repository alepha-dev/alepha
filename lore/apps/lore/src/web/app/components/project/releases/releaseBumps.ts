import { compareReleaseTags, parseReleaseTag } from "@/api/releaseOrder.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";

/**
 * What a row may offer to create next: which part of the version moves, and
 * the tag that results.
 */
export interface ReleaseBump {
  kind: "patch" | "minor" | "major";
  tag: string;
}

/**
 * The three fields the rule reads. `number` is the release's identity inside
 * a project and the tiebreak between tags that compare equal; `releasedAt` is
 * read by the patch rule and by nothing else.
 */
export type ReleaseBumpSubject = Pick<
  ReleaseResource,
  "number" | "tag" | "releasedAt"
>;

/**
 * Which next versions a release row offers to create, as one rule: a row
 * offers a bump when it is the FRONTIER of that line.
 *
 * - **major** when it is the highest candidate in the project;
 * - **minor** when it is the highest candidate within its major;
 * - **patch** when it is the highest candidate within its `major.minor`, and
 *   only once it has shipped (`releasedAt`), since a patch of something that
 *   has not shipped is meaningless.
 *
 * ## Why the frontier and not the release's state
 *
 * The first draft gated on state: released rows offered a patch, open rows a
 * major and a minor. It breaks on the next step of any project that plans a
 * far-future release. With `0.29.0` released, `0.30.0` and `1.0.0` open,
 * publishing `0.30.0` leaves `1.0.0` the only open row, so nothing would offer
 * `0.31.0`, which is the release actually created next. State is a proxy for
 * "the current line of work" and stops being one as soon as a far-future
 * release sits open. `releasedAt` survives in the patch rule only.
 *
 * ## Candidates, filtered BEFORE anything is ordered
 *
 * Only a tag `parseReleaseTag` accepts, with no suffix and at most three
 * segments, takes part. Everything else offers nothing AND is left out of
 * every comparison.
 *
 * ⚠️ The order matters. `compareReleaseTags` sorts a named tag (`demo-1`)
 * after every version, on purpose, so "the highest release in the project"
 * taken over the raw list is `demo-1` in any project that has one, and no row
 * would ever offer a major.
 *
 * - A suffixed tag (`1.0.0-rc.1`, `1.0.0+build`) is skipped because the
 *   filter has to do something with one. Prereleases are out of scope: how an
 *   open one should interact with the offers around it was deliberately not
 *   designed (epic #E56).
 * - Four or more segments (`1.2.3.4`, a calendar tag) are skipped because a
 *   bump would have to drop a segment the project chose to use.
 *
 * ## Ties
 *
 * `1.0` beside `1.0.0`, or `v1.0.0` beside `1.0.0`, compare equal. Ordering
 * by `compareReleaseTags || number`, the Tag column's own comparator, makes
 * the most recently created one the frontier, so exactly one row offers.
 *
 * ## No "already exists" check, on purpose
 *
 * Over candidates, the frontier makes a collision impossible: a bump of the
 * highest `x.y.*` is above everything in `x.y`, and the same holds one level
 * up. `releaseBumps.spec.ts` asserts it as an invariant instead of the code
 * checking it twice. A tag created elsewhere since the list was read is the
 * create dialog's tag-taken error, which is why a bump opens that dialog
 * rather than writing.
 *
 * ## Output
 *
 * The row's own `v` or `V` prefix is kept byte for byte: the tag is the join
 * key to `artifacts.tag`, and a bump that dropped it would fork the tag
 * namespace. Output is normalised to three segments (`1.0` bumps to `1.1.0`),
 * and leading zeros are not kept. Entries come in ascending tag order: patch,
 * minor, major.
 *
 * @param release The row asking.
 * @param all The project's WHOLE release list. Never the rows a filter left
 * on screen: filtered to Released, `0.30.0` is not a row, and `0.29.0` would
 * look like the frontier of major 0 and offer `0.30.0`, which exists.
 */
export const releaseBumps = (
  release: ReleaseBumpSubject,
  all: ReleaseBumpSubject[],
): ReleaseBump[] => {
  const self = toCandidate(release);
  if (!self) return [];
  const candidates = all
    .map(toCandidate)
    .filter((it): it is Candidate => Boolean(it));
  const [major, minor, patch] = self.core;

  const isFrontierOf = (inLine: (it: Candidate) => boolean): boolean =>
    highestOf(candidates.filter(inLine))?.release.number === release.number;

  const bumps: ReleaseBump[] = [];
  if (
    release.releasedAt &&
    isFrontierOf((it) => it.core[0] === major && it.core[1] === minor)
  ) {
    bumps.push({
      kind: "patch",
      tag: `${self.prefix}${major}.${minor}.${patch + 1}`,
    });
  }
  if (isFrontierOf((it) => it.core[0] === major)) {
    bumps.push({ kind: "minor", tag: `${self.prefix}${major}.${minor + 1}.0` });
  }
  if (isFrontierOf(() => true)) {
    bumps.push({ kind: "major", tag: `${self.prefix}${major + 1}.0.0` });
  }
  return bumps;
};

/**
 * The tag the create dialog's placeholder suggests when nobody picked one:
 * "the project's next minor".
 *
 * Not a second rule. It is the `minor` entry {@link releaseBumps} returns for
 * the frontier row of one major, and the only decision here is WHICH major.
 *
 * ## Anchored on the highest RELEASED version
 *
 * The frontier rule dropped the state axis for gating offers, because a
 * far-future open `1.0.0` breaks it. "Where is this project now" has to
 * ignore that same far-future release, and shipped is what says where a
 * project is. With `0.28.0` and `0.29.0` released and `0.30.0` and `1.0.0`
 * open, the anchor is `0.29.0`, the frontier of major 0 is `0.30.0`, and the
 * suggestion is `0.31.0` rather than `1.1.0`.
 *
 * When nothing has shipped yet, the highest candidate is the anchor.
 * `undefined` when there is no candidate at all, which is what leaves the
 * dialog on its fixed placeholder.
 */
export const suggestedReleaseTag = (
  all: ReleaseBumpSubject[],
): string | undefined => {
  const candidates = all
    .map(toCandidate)
    .filter((it): it is Candidate => Boolean(it));
  const anchor =
    highestOf(candidates.filter((it) => it.release.releasedAt)) ??
    highestOf(candidates);
  if (!anchor) return undefined;
  const frontier = highestOf(
    candidates.filter((it) => it.core[0] === anchor.core[0]),
  );
  if (!frontier) return undefined;
  return releaseBumps(frontier.release, all).find((it) => it.kind === "minor")
    ?.tag;
};

/**
 * A release that takes part in the rule, with its tag read once.
 */
interface Candidate {
  release: ReleaseBumpSubject;
  /**
   * `""`, `"v"` or `"V"`, exactly as the tag spells it.
   */
  prefix: string;
  /**
   * Always three numbers: `1.0` reads as `[1, 0, 0]`, which is how
   * `compareReleaseTags` already treats a missing segment.
   */
  core: [number, number, number];
}

const toCandidate = (release: ReleaseBumpSubject): Candidate | undefined => {
  const tag = release.tag?.trim();
  if (!tag) return undefined;
  const parts = parseReleaseTag(tag);
  if (!parts || parts.pre !== undefined || parts.core.length > 3) {
    return undefined;
  }
  return {
    release,
    prefix: /^[vV]/.test(tag) ? tag[0] : "",
    core: [parts.core[0], parts.core[1] ?? 0, parts.core[2] ?? 0],
  };
};

/**
 * The highest candidate under the Tag column's own comparator, so a tie goes
 * to the release created last.
 */
const highestOf = (candidates: Candidate[]): Candidate | undefined =>
  candidates.reduce<Candidate | undefined>((best, it) => {
    if (!best) return it;
    const order =
      compareReleaseTags(it.release.tag, best.release.tag) ||
      it.release.number - best.release.number;
    return order > 0 ? it : best;
  }, undefined);
