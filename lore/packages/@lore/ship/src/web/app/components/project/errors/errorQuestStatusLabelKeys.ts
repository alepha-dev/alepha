/**
 * The label of a quest's status beside an error forwarded to it.
 *
 * Plan's own map (`QUEST_STATUS_LABEL_KEYS`) is not importable from Ship
 * (#E75): the status reaches the error page as a string, through the `quest`
 * kind of the resources registry, and these are the same dictionary keys. A
 * status this map does not know shows no badge.
 */
export const ERROR_QUEST_STATUS_LABEL_KEYS = {
  todo: "quest.status.todo",
  in_progress: "quest.status.inProgress",
  on_hold: "quest.status.onHold",
  completed: "quest.status.completed",
  shelved: "quest.status.shelved",
} as const;

export type ErrorQuestStatus = keyof typeof ERROR_QUEST_STATUS_LABEL_KEYS;
