/**
 * The most objectives one quest may be given.
 *
 * The owner's rule: past ten, the work is not one quest. It is a product
 * decision rather than a storage limit, so it is enforced on the write paths
 * and nowhere near the column.
 *
 * ## ⚠️ Why this is NOT on the entity schema
 *
 * Putting `.max()` on `quests.objectives` would look like the tidy place for
 * it and would be a production outage. The entity schema decodes reads as
 * well as writes, and quests already exist with more than ten objectives, so
 * every read of one would fail validation. That is verbatim the 2026-08-05
 * incident, where a required key inside a JSON column stopped 54 existing
 * rows from decoding and took every project read down.
 *
 * ## The rule is "may not GROW past ten", not "may not BE over ten"
 *
 * A flat cap on the update path breaks the same existing quests a different
 * way: renaming a fifteen-objective quest sends its fifteen objectives back
 * unchanged, and a flat cap refuses that. So an update is refused only when
 * the incoming count is both over the cap AND larger than what the row
 * already holds. See {@link exceedsObjectiveCap}.
 *
 * Create has no such history, so create is a flat cap.
 */
export const MAX_QUEST_OBJECTIVES = 10;

/**
 * Whether an update should be refused: over the cap, and growing.
 *
 * `current` is the count the row holds today. Passing a quest that is
 * already over the cap through unchanged is allowed, and so is shrinking it
 * toward the cap, because neither makes the situation worse and refusing
 * either would strand a quest nobody can edit.
 */
export const exceedsObjectiveCap = (next: number, current: number): boolean =>
  next > MAX_QUEST_OBJECTIVES && next > current;

/**
 * The refusal, in one place so HTTP and MCP say the same thing.
 */
export const objectiveCapMessage = (next: number): string =>
  `A quest may carry at most ${MAX_QUEST_OBJECTIVES} objectives, and this one would have ${next}. More than that means the work is not one quest: split it, or file the rest as their own quests.`;
