import type { BadgeTone } from "@alepha/ui";
import type { LucideIcon } from "lucide-react";
import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CircleSlash,
} from "lucide-react";

import type { EpicResource } from "../../../../../api/schemas/epicResourceSchema.ts";

export type EpicStatus = EpicResource["status"];

export type EpicStatusLabelKey =
  | "epic.status.draft"
  | "epic.status.ready"
  | "epic.status.inProgress"
  | "epic.status.completed"
  | "epic.status.shelved";

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
  draft: "epic.status.draft",
  ready: "epic.status.ready",
  in_progress: "epic.status.inProgress",
  completed: "epic.status.completed",
  shelved: "epic.status.shelved",
};

/**
 * The hue an epic status wears, on the same semantic scale Lore already
 * points its quest statuses at (`questChips.ts`) and along the same
 * lifecycle: a ready epic is `info` like a new quest (in the backlog, not
 * started), in progress is `warning` like an accepted one, and completed is
 * `success`. An epic and the quests inside it therefore read as the same
 * colour when they are at the same stage, which is the whole point of naming
 * meanings instead of hexes. `draft` sits below all of them as `neutral`:
 * nothing in it can be worked yet. `shelved` (#E78) is `neutral` too, as a
 * shelved quest is (`questChips.ts`): it is the absence of a state, and
 * never the `success` of a completed one.
 *
 * This replaced a `variant` map (`outline` / `default` / `secondary`),
 * where the in-flight status was a solid primary chip: the loudest thing in
 * the row, competing with the progress bar beside it for the same fact.
 */
export const STATUS_TONE: Record<EpicStatus, BadgeTone> = {
  draft: "neutral",
  ready: "info",
  in_progress: "warning",
  completed: "success",
  shelved: "neutral",
};

/**
 * One glyph per status, so the chip survives being read in monochrome and
 * by anyone who does not separate amber from emerald. The four are one
 * shape deliberately: a circle that is dashed while the epic is being
 * specified, whole once it is ready, broken into motion while it runs, and
 * closed with a tick when it completes. A shelved epic is the circle struck
 * through: set aside, and visibly not the tick.
 */
export const STATUS_ICONS: Record<EpicStatus, LucideIcon> = {
  draft: CircleDashed,
  ready: Circle,
  in_progress: CircleDotDashed,
  completed: CircleCheck,
  shelved: CircleSlash,
};

/**
 * The display order of the statuses, which is the lifecycle's order, with
 * `shelved` after `completed`: it is off the path rather than a step on it.
 * Sorting them alphabetically would read as arbitrary (completed, in
 * progress, draft, ready).
 */
export const STATUS_ORDER: Record<EpicStatus, number> = {
  draft: 0,
  ready: 1,
  in_progress: 2,
  completed: 3,
  shelved: 4,
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

/**
 * The quests an epic shelve would move (#E78): neither completed nor
 * already shelved. The progress buckets are disjoint
 * (`epicResourceSchema`), so this is a subtraction rather than a second
 * read. The page control and the list row both confirm with it.
 */
export const openQuestsOf = (epic: Pick<EpicResource, "progress">): number =>
  epic.progress.total - epic.progress.completed - epic.progress.shelved;
