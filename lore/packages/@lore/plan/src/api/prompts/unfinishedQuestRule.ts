import { PROMPT_NEEDS_HUMAN_TAG } from "@lore/core/schemas";

import { QUEST_NEEDS_ANSWER_TAG } from "../schemas/questPresets.ts";

/**
 * The rule every work prompt carries (#Q4279): a quest that is not 100% done
 * says so on the quest, where the next person or agent looks, and one that
 * waits on the owner shows under Asks. The tag is named by its constant, so
 * one place owns the string.
 */
export const unfinishedQuestRule = `## A quest not fully done

Before you complete or leave a quest, check it against its description and its objectives. If anything is not done, or done differently from what was asked, write one comment on the quest with \`quest_comment_add\`, before you move on and not at the end of the run: what is left, why, and what it would take. A quest that is fully done gets no such comment. Your reply still lists them.

When that comment asks the owner something (a decision, a choice between options, a missing input), add the tag \`${QUEST_NEEDS_ANSWER_TAG}\` to the quest with \`quest_update\`, keeping its other tags, and do not complete it: it then shows under Asks. When the comment only reports what was left out, no tag. This holds too for a quest that cannot be done as written.

A quest already tagged \`${QUEST_NEEDS_ANSWER_TAG}\`: read its discussion first. If the question was answered since, remove the tag and work the quest with that answer. If not, skip it and name it in your reply, rather than asking again.

\`${QUEST_NEEDS_ANSWER_TAG}\` is not \`${PROMPT_NEEDS_HUMAN_TAG}\`: \`${PROMPT_NEEDS_HUMAN_TAG}\` says an agent should not build the quest alone, \`${QUEST_NEEDS_ANSWER_TAG}\` that a question is open. A quest can carry both.`;
