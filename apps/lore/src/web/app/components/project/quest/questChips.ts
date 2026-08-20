import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

/**
 * The tone each quest status and priority wears.
 *
 * One table, read by the quest table and the quest view alike, so a status
 * cannot look like one thing in the list and another on the quest. The tones
 * themselves live in `@alepha/ui`'s `Badge`: this file only says which
 * meaning maps to which, which is the part that belongs to Lore.
 */
export type QuestTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * `shelved` is deliberately neutral: it is the absence of a state, and
 * tinting it would give a parked quest more presence than an active one.
 */
export const QUEST_STATUS_TONE: Record<
  QuestResource["metadata"]["status"],
  QuestTone
> = {
  new: "info",
  accepted: "warning",
  completed: "success",
  shelved: "neutral",
};

/**
 * `optional` is neutral for the same reason: it is the one priority that
 * asks nothing of the reader.
 */
export const QUEST_PRIORITY_TONE: Record<QuestResource["priority"], QuestTone> =
  {
    high: "danger",
    medium: "warning",
    low: "info",
    optional: "neutral",
  };
