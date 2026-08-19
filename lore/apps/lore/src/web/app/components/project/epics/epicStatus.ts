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

export const STATUS_BADGE_VARIANT: Record<
  EpicStatus,
  "outline" | "default" | "secondary"
> = {
  planned: "outline",
  active: "default",
  done: "secondary",
};
