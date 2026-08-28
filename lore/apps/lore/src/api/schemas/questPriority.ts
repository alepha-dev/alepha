import type { Quest } from "../entities/quests.ts";

export type QuestPriority = Quest["priority"];

/**
 * Rank of each priority, highest last, for sorting.
 *
 * ⚠️ **`quests.priority` is a TEXT enum, so you cannot `ORDER BY` it.**
 * SQLite sorts the label, not the meaning, and the labels happen to sort
 * `optional > medium > low > high` — the exact reverse of severity. A
 * `priority desc` in SQL therefore puts the least important work first,
 * silently and forever. The kanban board did precisely that from the day it
 * was written until 2026-08-28.
 *
 * The entity already warns about this from the other direction: `size` is
 * stored as an ordinal specifically because "storing the ordinal rather
 * than the label keeps ordering in SQL; `priority` is a text enum". This
 * table is what the label costs.
 *
 * Three places order by priority and all three must use this:
 * - `KanbanController.orderForBoard` (JS, on the board's fallback order)
 * - `QuestGroup` (JS, the grouped quest list)
 * - `ProjectReportsController` (SQL, via a CASE built from these ranks)
 */
export const QUEST_PRIORITY_ORDER: Record<QuestPriority, number> = {
  optional: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Comparator putting the most urgent first, for `Array.sort`.
 *
 * Returns 0 for equal priorities, so a stable sort leaves whatever order
 * the caller already had — which is how the board keeps `updatedAt desc`
 * as its tie-break.
 */
export const byPriorityDesc = (
  a: { priority: QuestPriority },
  b: { priority: QuestPriority },
): number =>
  QUEST_PRIORITY_ORDER[b.priority] - QUEST_PRIORITY_ORDER[a.priority];
