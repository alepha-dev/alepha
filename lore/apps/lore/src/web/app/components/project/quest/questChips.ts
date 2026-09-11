import {
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  type LucideIcon,
  Minus,
} from "lucide-react";

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
 *
 * `on_hold` is `danger`, and it is the only status that shouts. A quest on
 * hold is the one thing on a board that will not move on its own: shelved
 * needs nobody, to do and in progress are proceeding, and completed is done.
 * Reading as loud as `high` priority is correct here, because the whole point
 * of the status is that somebody has to go and unblock it.
 */
export const QUEST_STATUS_TONE: Record<
  QuestResource["metadata"]["status"],
  QuestTone
> = {
  todo: "info",
  in_progress: "warning",
  on_hold: "danger",
  completed: "success",
  shelved: "neutral",
};

export type QuestStatusLabelKey =
  | "quest.status.todo"
  | "quest.status.inProgress"
  | "quest.status.onHold"
  | "quest.status.completed"
  | "quest.status.shelved";

/**
 * Badge copy for a quest's status, shared by every surface that draws it.
 *
 * The keys are camelCase while `in_progress` and `on_hold` are not: this map
 * is the one place the two meet, as `STATUS_LABEL_KEYS` is for epics, so
 * nothing builds a key from the status string by hand.
 */
export const QUEST_STATUS_LABEL_KEYS: Record<
  QuestResource["metadata"]["status"],
  QuestStatusLabelKey
> = {
  todo: "quest.status.todo",
  in_progress: "quest.status.inProgress",
  on_hold: "quest.status.onHold",
  completed: "quest.status.completed",
  shelved: "quest.status.shelved",
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

/**
 * The priority glyph. An arrow idiom rather than four differently-coloured
 * dots: the shape says which way the priority points even before the tone
 * registers, which is what makes the column scannable in monochrome.
 *
 * Shared by every table that shows a priority chip, so the epic's quests
 * and the Quests list draw the same arrow for the same word.
 */
export const QUEST_PRIORITY_ICONS: Record<
  QuestResource["priority"],
  LucideIcon
> = {
  high: ChevronsUp,
  medium: ChevronUp,
  low: ChevronDown,
  optional: Minus,
};

/**
 * What a table sorts on when it sorts by priority. The label is a word, and
 * sorting the word puts "high" under "low" under "medium": alphabetical,
 * and wrong. The Quests list escapes it by sorting server-side on the
 * entity; a table holding its rows in memory has to say the order itself.
 */
export const QUEST_PRIORITY_RANK: Record<QuestResource["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
  optional: 3,
};
