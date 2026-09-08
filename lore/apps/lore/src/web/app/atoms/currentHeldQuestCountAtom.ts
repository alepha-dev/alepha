import { $atom, z } from "alepha";

/**
 * Number of quests on hold in the current project.
 *
 * A SUBSET of `currentQuestCountAtom`, not a sibling population: a held quest
 * is blocked rather than out of scope, so it is open and both numbers count
 * it. The sidebar shows them next to each other and they are meant to overlap
 * - Quests 12, On hold 3 reads as "three of the twelve are stuck".
 *
 * ⚠️ The badge exists to be zero. An entry that reads nothing most of the
 * time and turns into a number when somebody is waiting is a signal; a page
 * you have to remember to visit is not, which is the whole of what was
 * reported. So the entry renders whatever the count, and only the number
 * comes and goes.
 *
 * Filled by the same `countOpenQuests` read that fills the open count, and by
 * `useQuestMutations.refreshCount` after every transition, so putting a quest
 * on hold moves the badge without a reload. Reset to `{ count: 0 }` on
 * project leave.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const currentHeldQuestCountAtom = $atom({
  name: "lor.current.held_quest_count",
  schema: z.object({
    count: z.integer(),
  }),
  default: { count: 0 },
});
