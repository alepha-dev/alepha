/**
 * The sentinel the quests release filter uses to mean "attached to no
 * release", alongside the numeric release ids in the same multi-value
 * parameter.
 *
 * A sentinel rather than a second query parameter, because the filter is one
 * multi-select and its selections OR together: "no release, or 0.29.0" has to
 * be expressible, and two parameters would AND. It is safe to put in the same
 * list because release ids are integers, so nothing a release could ever be
 * called collides with it.
 *
 * Shared so the option's value and the branch that reads it cannot drift: a
 * literal on each side is one typo away from a filter that silently selects
 * nothing.
 */
export const QUEST_RELEASE_NONE = "none";
