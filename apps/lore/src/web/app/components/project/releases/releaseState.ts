import type { BadgeTone } from "@alepha/ui/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import { CircleCheck, CircleDotDashed } from "lucide-react";

import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";

/**
 * ⚠️ A release has TWO states and will never have three.
 *
 * This is derived from `releasedAt`, a timestamp, and is deliberately not a
 * `status` column the way an epic has one. There is no "active" state
 * because nothing pauses: a release is either still being filled or it has
 * shipped and frozen its counts. The page this replaced encoded the same
 * property as two headings; the table encodes it as a filter with exactly
 * two values.
 *
 * Deriving it rather than storing it is what keeps the two from disagreeing:
 * `releasedAt` is what `publishRelease` writes and what every server-side
 * guard reads, so a stored duplicate could only ever drift from it.
 */
export type ReleaseState = "open" | "released";

export const releaseState = (release: ReleaseResource): ReleaseState =>
  release.releasedAt ? "released" : "open";

export type ReleaseStateLabelKey =
  | "release.group.open"
  | "release.group.released";

export const STATE_LABEL_KEYS: Record<ReleaseState, ReleaseStateLabelKey> = {
  open: "release.group.open",
  released: "release.group.released",
};

/**
 * The same semantic scale the epic statuses use (`epicStatus.ts`), at the
 * same points of the lifecycle: in flight is `warning`, finished is
 * `success`. A release and the epics inside it therefore read as the same
 * colour when they are at the same stage.
 *
 * There is no `info` here, and that absence is the model: an epic is
 * specified before it starts, a release is not.
 */
export const STATE_TONE: Record<ReleaseState, BadgeTone> = {
  open: "warning",
  released: "success",
};

/**
 * One glyph per state, so the chip survives monochrome and anyone who does
 * not separate amber from emerald. Both are the same circle the epic chips
 * use, at the two points a release can be at.
 */
export const STATE_ICONS: Record<ReleaseState, LucideIcon> = {
  open: CircleDotDashed,
  released: CircleCheck,
};
