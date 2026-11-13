import { type Infer, z } from "alepha";

/**
 * The quest presets of the bar beside the Quests pages: each one is a set of
 * Quests table filters, written as the table's own URL query, so a preset is
 * a link (`/acme/quests?assignee=me&status=todo,in_progress,on_hold`) and the
 * table shows its filters as chips the reader can remove one by one.
 *
 * The server counts each preset from the same query (`getQuestPresets`), so a
 * badge and the list it opens cannot disagree.
 */
export const QUEST_PRESET_KEYS = [
  "mine",
  "urgent",
  "backlog",
  "done",
  "asks",
  "stale",
  "next",
] as const;

export type QuestPresetKey = (typeof QUEST_PRESET_KEYS)[number];

/**
 * The Quests table's URL keys a preset may set. Every value is the text the
 * URL carries; lists are comma-joined.
 */
export interface QuestPresetQuery {
  status?: string;
  assignee?: "me" | "none";
  priority?: string;
  tag?: string;
  release?: string;
  stale?: string;
  completed?: string;
}

/**
 * Not done: to do, in progress or on hold. Shelved quests are out of scope.
 */
const OPEN = "todo,in_progress,on_hold";

/**
 * In progress for more than this many days: what Reports calls stale.
 */
export const QUEST_STALE_DAYS = 14;

/**
 * How far back Done looks.
 */
export const QUEST_DONE_DAYS = 7;

/**
 * The tag a quest carries while it waits on somebody's answer.
 */
export const QUEST_NEED_ANSWER_TAG = "need-answer";

/**
 * The query each preset opens. `next` needs the next release's id, which only
 * the server knows; without one it has no query.
 */
export const questPresetQuery = (
  key: QuestPresetKey,
  nextReleaseId?: number,
): QuestPresetQuery | undefined => {
  switch (key) {
    case "mine":
      return { assignee: "me", status: OPEN };
    case "urgent":
      return { priority: "high", status: OPEN };
    case "backlog":
      // Everything still pending, taken or not: the whole of what is left.
      return { status: OPEN };
    case "done":
      return { status: "completed", completed: String(QUEST_DONE_DAYS) };
    case "asks":
      return { tag: QUEST_NEED_ANSWER_TAG, status: OPEN };
    case "stale":
      return { status: "in_progress", stale: String(QUEST_STALE_DAYS) };
    case "next":
      return nextReleaseId === undefined
        ? undefined
        : { release: String(nextReleaseId), status: OPEN };
  }
};

export const questPresetsSchema = z.object({
  /**
   * The open release with the lowest number, which Next opens.
   */
  nextRelease: z
    .object({ id: z.integer(), label: z.string() })
    .optional(),
  counts: z.object({
    mine: z.integer(),
    urgent: z.integer(),
    backlog: z.integer(),
    done: z.integer(),
    asks: z.integer(),
    stale: z.integer(),
    next: z.integer(),
  }),
});

export type QuestPresets = Infer<typeof questPresetsSchema>;
