/**
 * The sentinel the quests epic filter uses to mean "filed under no epic",
 * alongside the numeric epic ids in the same multi-value parameter.
 *
 * A sentinel rather than a second query parameter, for the reason
 * `QUEST_RELEASE_NONE` is one: the filter is one multi-select whose
 * selections OR together, so "no epic, or epic 12" has to be expressible, and
 * two parameters would AND. Epic ids are integers, so nothing collides with
 * it.
 *
 * Shared so the option's value and the branch that reads it cannot drift.
 */
export const QUEST_EPIC_NONE = "none";
