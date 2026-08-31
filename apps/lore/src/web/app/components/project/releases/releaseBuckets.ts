import type { LucideIcon } from "lucide-react";
import {
  Archive,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
} from "lucide-react";

import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";

/**
 * The four buckets a release's quests fall into, in the order they are drawn.
 *
 * `open` is derived and the other three come from the server, which is the
 * whole point: `total`, `completed`, `inProgress` and `shelved` are the four
 * numbers `ReleaseController.progressOf` computes for an open release and
 * stamps onto the row at publish, and `open` is whatever the first three do
 * not claim.
 */
export type ReleaseBucket = "completed" | "inProgress" | "open" | "shelved";

export interface ReleaseBuckets {
  completed: number;
  inProgress: number;
  open: number;
  shelved: number;
  /**
   * Work still in scope: `completed + inProgress + open`. **Not** the length
   * of the four buckets added up, because `shelved` sits outside it - see
   * `releases.total`.
   */
  total: number;
  /**
   * `inProgress + open`. What "still to land" means, and the one number the
   * page states in prose.
   */
  remaining: number;
  /**
   * `completed / total` as a whole percent, `0` for an empty release.
   */
  percent: number;
}

/**
 * ⚠️ **The one derivation on this page. Never hand-set a count beside it.**
 *
 * Every number the release view prints comes from here: the plate's ratio,
 * the four bar segments, each segment's tooltip, the "ready to ship"
 * percentage and the prose under it. The prototype this was built from kept
 * them as separate constants and they disagreed with each other in three
 * places within a day.
 *
 * The subtraction has no `- shelved` in it. A shelved quest is declined work
 * and the server leaves it out of `total`, so subtracting it here would
 * remove it twice and under-report the open remainder. `ProjectEpicsProgress`
 * *does* subtract it, correctly, because an epic's `total` counts every quest
 * it holds. Two rollups, same field names, different denominators - which is
 * exactly why this lives in one file rather than inline at four call sites.
 */
export const releaseBuckets = (
  progress: ReleaseResource["progress"],
): ReleaseBuckets => {
  const { completed, inProgress, shelved, total } = progress;
  const open = Math.max(0, total - completed - inProgress);
  return {
    completed,
    inProgress,
    open,
    shelved,
    total,
    remaining: inProgress + open,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
};

/**
 * The fill each bucket wears, identical to `ProjectEpicsProgress`'s tick
 * tones so a release and the epics inside it read as one scale.
 *
 * Done is the primary colour and in-flight is a faded version of it; the two
 * kinds of not-done are separated on purpose, because shelved work is
 * declined rather than outstanding and must not look like a quest still
 * waiting its turn.
 */
export const BUCKET_FILL: Record<ReleaseBucket, string> = {
  completed: "bg-primary",
  inProgress: "bg-primary/45",
  open: "bg-muted-foreground/30",
  shelved: "bg-muted-foreground/60",
};

export type ReleaseBucketLabelKey =
  | "release.bucket.completed"
  | "release.bucket.inProgress"
  | "release.bucket.open"
  | "release.bucket.shelved";

export const BUCKET_LABEL_KEYS: Record<ReleaseBucket, ReleaseBucketLabelKey> = {
  completed: "release.bucket.completed",
  inProgress: "release.bucket.inProgress",
  open: "release.bucket.open",
  shelved: "release.bucket.shelved",
};

/**
 * Drawing order, done first. Left to right the bar reads as a timeline of
 * the work: finished, moving, waiting, and then - past a gap - declined.
 */
export const BUCKET_ORDER: ReleaseBucket[] = [
  "completed",
  "inProgress",
  "open",
  "shelved",
];

/**
 * One glyph per bucket, so a row survives monochrome and anyone who does not
 * separate amber from emerald. The same circle at four points of a quest's
 * life: closed with a tick when done, broken into motion while it runs,
 * dashed while it waits - and a box, not a circle, once it is put away,
 * because being shelved is not a later stage of the same journey.
 */
export const BUCKET_ICONS: Record<ReleaseBucket, LucideIcon> = {
  completed: CircleCheck,
  inProgress: CircleDotDashed,
  open: CircleDashed,
  shelved: Archive,
};

/**
 * The hue each glyph wears.
 *
 * `emerald-500` and `amber-500` are the exact values `Badge`'s `success` and
 * `warning` tones are built from, so the icon in a row and the chip above it
 * are one palette rather than two that happen to look alike. An icon cannot
 * use the badge itself - there is no label to tint around.
 */
export const BUCKET_ICON_CLASS: Record<ReleaseBucket, string> = {
  completed: "text-emerald-500",
  inProgress: "text-amber-500",
  open: "text-muted-foreground",
  shelved: "text-muted-foreground/60",
};

/**
 * Which bucket a quest row falls into, from the three timestamps.
 *
 * The same partition `ReleaseController.progressOf` counts, written once so a
 * row's glyph and the segment it was counted into cannot disagree. Order
 * matters: `shelvedAt` is only ever set on a quest still in `new` status, but
 * testing it first means a row can never be read as two things at once even
 * if that invariant is ever relaxed.
 */
export const questBucket = (quest: {
  completedAt?: string;
  acceptedAt?: string;
  shelvedAt?: string;
}): ReleaseBucket =>
  quest.shelvedAt
    ? "shelved"
    : quest.completedAt
      ? "completed"
      : quest.acceptedAt
        ? "inProgress"
        : "open";
