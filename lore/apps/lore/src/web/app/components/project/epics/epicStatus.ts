import type { BadgeTone } from "@alepha/ui/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
} from "lucide-react";

import {
  type EpicResource,
  epicResourceSchema,
} from "@/api/schemas/epicResourceSchema.ts";

export type EpicStatus = EpicResource["status"];

/**
 * Every status, in lifecycle order, read off the column's own enum (which
 * declares them in that order) rather than restated. What a picker offering
 * all four iterates.
 */
export const EPIC_STATUSES = epicResourceSchema.shape.status.options;

export type EpicStatusLabelKey =
  | "epic.status.planned"
  | "epic.status.ready"
  | "epic.status.inProgress"
  | "epic.status.completed";

/**
 * Badge copy for an epic's current status. Shared by every surface that
 * draws the chip (the list, the aside, the roadmap, the release page, the
 * dashboard's scope step) so none of them drifts on wording.
 *
 * The keys are camelCase while `in_progress` is not: the map is the one
 * place the two meet, which is why nothing should build a key from the
 * status string by hand.
 */
export const STATUS_LABEL_KEYS: Record<EpicStatus, EpicStatusLabelKey> = {
  planned: "epic.status.planned",
  ready: "epic.status.ready",
  in_progress: "epic.status.inProgress",
  completed: "epic.status.completed",
};

/**
 * The hue an epic status wears, on the same semantic scale Lore already
 * points its quest statuses at (`questChips.ts`) and along the same
 * lifecycle: a ready epic is `info` like a new quest (in the backlog, not
 * started), in progress is `warning` like an accepted one, and completed is
 * `success`. An epic and the quests inside it therefore read as the same
 * colour when they are at the same stage, which is the whole point of naming
 * meanings instead of hexes. `planned` sits below all of them as `neutral`:
 * nothing in it can be worked yet.
 *
 * This replaced a `variant` map (`outline` / `default` / `secondary`),
 * where the in-flight status was a solid primary chip: the loudest thing in
 * the row, competing with the progress bar beside it for the same fact.
 */
export const STATUS_TONE: Record<EpicStatus, BadgeTone> = {
  planned: "neutral",
  ready: "info",
  in_progress: "warning",
  completed: "success",
};

/**
 * One glyph per status, so the chip survives being read in monochrome and
 * by anyone who does not separate amber from emerald. The four are one
 * shape deliberately: a circle that is dashed while the epic is being
 * specified, whole once it is ready, broken into motion while it runs, and
 * closed with a tick when it completes.
 */
export const STATUS_ICONS: Record<EpicStatus, LucideIcon> = {
  planned: CircleDashed,
  ready: Circle,
  in_progress: CircleDotDashed,
  completed: CircleCheck,
};

/**
 * The display order of the four statuses, which is the lifecycle's order.
 * Sorting them alphabetically would read as arbitrary (completed, in
 * progress, planned, ready).
 */
export const STATUS_ORDER: Record<EpicStatus, number> = {
  planned: 0,
  ready: 1,
  in_progress: 2,
  completed: 3,
};

/**
 * The predecessor that blocks the start, as its per-project number, or
 * `undefined` when nothing does.
 *
 * `epics.dependsOn` gates the START: no quest of an epic is accepted while
 * its predecessor is not completed (#Q2223; it gated the Begin click
 * before). Several surfaces ask the same question (the epic page's status
 * control, the aside's predecessor row), so it is answered once, off the two
 * fields the resource carries for exactly this.
 */
export const epicBlockedBy = (
  epic: Pick<EpicResource, "dependsOnNumber" | "dependsOnStatus">,
): number | undefined =>
  epic.dependsOnNumber !== undefined &&
  epic.dependsOnStatus !== undefined &&
  epic.dependsOnStatus !== "completed"
    ? epic.dependsOnNumber
    : undefined;
