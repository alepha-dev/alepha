/**
 * The quest list's `status` value for "every quest still in scope, drafts
 * included": every status but `shelved`, comma-separated as the list reads it.
 *
 * The default list leaves drafts out, as it leaves shelved quests out (#E178),
 * so a reader that needs them names `draft` beside the statuses it wants. The
 * pickers that offer any quest of the project (`QuestDependencyPicker`, the
 * `#Q` autocomplete) send this.
 * A held draft is not in it: `on_hold` leaves a held draft out.
 */
export const QUEST_STATUSES_WITH_DRAFTS =
  "todo,draft,in_progress,on_hold,completed";
