import type { BadgeTone } from "@alepha/ui/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import { CircleCheck, CircleDashed, CircleDotDashed } from "lucide-react";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";

export type EpicStatus = EpicResource["status"];

export type EpicStatusLabelKey =
  | "epic.status.planned"
  | "epic.status.active"
  | "epic.status.done";

/**
 * Badge copy for an epic's current status. Shared between the list
 * (`ProjectEpics.tsx`) and the detail page's `EpicStatusControl` so the
 * two surfaces never drift on wording.
 */
export const STATUS_LABEL_KEYS: Record<EpicStatus, EpicStatusLabelKey> = {
  planned: "epic.status.planned",
  active: "epic.status.active",
  done: "epic.status.done",
};

/**
 * The hue an epic status wears, on the same semantic scale Lore already
 * points its quest statuses at (`questChips.ts`) and along the same
 * lifecycle: specified is `info`, in flight is `warning`, finished is
 * `success`. An epic and the quests inside it therefore read as the same
 * colour when they are at the same stage, which is the whole point of
 * naming meanings instead of hexes.
 *
 * This replaced a `variant` map (`outline` / `default` / `secondary`),
 * where "active" was a solid primary chip: the loudest thing in the row,
 * competing with the progress bar beside it for the same fact.
 */
export const STATUS_TONE: Record<EpicStatus, BadgeTone> = {
  planned: "info",
  active: "warning",
  done: "success",
};

/**
 * One glyph per status, so the chip survives being read in monochrome and
 * by anyone who does not separate amber from emerald. The three are one
 * shape deliberately: a circle that is dashed while the epic is only
 * specified, broken into motion while it runs, and closed with a tick when
 * it concludes.
 */
export const STATUS_ICONS: Record<EpicStatus, LucideIcon> = {
  planned: CircleDashed,
  active: CircleDotDashed,
  done: CircleCheck,
};
