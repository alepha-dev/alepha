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
