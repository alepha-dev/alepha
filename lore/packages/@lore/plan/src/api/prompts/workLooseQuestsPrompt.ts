import { PROMPT_NEEDS_HUMAN_TAG } from "@lore/core/schemas";

import { QUEST_NEEDS_ANSWER_TAG } from "../schemas/questPresets.ts";
import { reviewStepRule } from "./reviewStepRule.ts";
import { unfinishedQuestRule } from "./unfinishedQuestRule.ts";
import { visualCheckRule } from "./visualCheckRule.ts";

/**
 * How many quests one run of `work-loose-quests` takes at most (#Q4406).
 */
export const LOOSE_QUESTS_PER_RUN = 10;

/**
 * `work-loose-quests` (#E174): the quests under no epic, one pull request
 * for the run. The list is taken once, at the start, and accepted whole,
 * at most {@link LOOSE_QUESTS_PER_RUN} quests (#Q4406): a quest filed
 * while the run works waits for the next run, so a run has an end.
 *
 * ⚠️ English, never localized: its words name the tools it calls. No
 * secret ever goes in: it leaves Lore on a clipboard or in a job.
 */
export const workLooseQuestsPromptText = `Work the loose quests of the Lore project "{{project}}", at most ${LOOSE_QUESTS_PER_RUN}, one at a time, in one run and one pull request: quests in \`todo\` that belong to no epic and are not tagged \`${PROMPT_NEEDS_HUMAN_TAG}\`. The run takes its list once, at the start, works it, and ends.

The quests: {{projectUrl}}/quests

## Before touching code

- Work in a git worktree of your own, on one branch for the whole run, cut from the latest main. Never on main. The run lands as one pull request holding one commit per quest.
- Orient with \`project_context\` (project_name "{{project}}"), and read the repository's AGENTS.md (or CLAUDE.md): it names the local checks.

## The list, taken once

Before the first quest, take this run's list. It is read once and never again:

1. Call \`quest_list\` with status "todo" (page through it with \`limit\` and \`offset\` until you have every row) and keep the quests that carry no \`epic\` and no \`${PROMPT_NEEDS_HUMAN_TAG}\` tag: an agent does not build those alone. A quest under an epic is not part of this run: an epic is worked through its own prompt.
2. A quest tagged \`${QUEST_NEEDS_ANSWER_TAG}\` is never skipped on its tag alone: \`quest_get\` it, and if its question was answered in the discussion since, remove the tag and keep it, to work with that answer. If not, leave it out and name it in your reply. Read the quests in \`in_progress\` tagged \`${QUEST_NEEDS_ANSWER_TAG}\` the same way (\`quest_list\` with status "in_progress" and that tag, loose ones only): an earlier run may have left one accepted on its question, and once answered it is a candidate too.
3. Order them by priority, then by what the others depend on, and keep the first ${LOOSE_QUESTS_PER_RUN}. The rest wait for the next run.
4. \`quest_accept\` every quest on the list now, before the first commit: an accepted quest is this run's, and another run leaves it alone.

That list is the whole run. A quest filed while you work, or one that finishing another reveals, is not part of it: it waits in \`todo\` for the next run. Work the list in its order, one quest at a time.

## Each quest

1. \`quest_get\` it. Its objectives and its discussion are the contract. Check its premise against the code before changing anything: if it is already done or no longer applies, complete it with those objectives waived and say why.
2. Do the work. Tick each objective with \`quest_objective_set\` as it is met, not at the end.
3. Run the project's local checks and fix everything red. A skipped check is a failure, not a pass. A change the user sees also gets a look ("A look at what the user sees", below).
4. Commit it as one commit, naming the quest in its message. One quest is one commit: a later fix to this quest goes into its commit (a fixup, squashed into it before you push), never into another quest's.
5. Push the branch. After the first quest, open a pull request into main for the run, as a draft: its title says it is a run of loose quests, and its description lists each quest with its link, kept up to date as the run goes. Record it on each quest with \`quest_pull_request_add\` (its URL, number and title) as you reach it, rather than posting its link as a comment.
6. \`quest_complete\` it with a short note: what shipped, and what was left out. A quest on the list that depends on it can then start.

If the project verifies on CI, every push runs it on the pull request, and that run is the source of truth: a green local check is not. Do not wait for it before starting the next quest, but read each run as it lands, and fix a red one in the commit of the quest it belongs to before going on.

If main moves and the pull request conflicts, rebase the branch onto the latest main and push with \`--force-with-lease\`. Never merge main into it: a merge commit breaks one commit per quest.

When a quest cannot be done as written, say so in a comment on it (\`quest_comment_add\`) and move on to the next on the list. Do not guess at a decision that is the owner's to make.

## When the list is done

1. Once every quest on the list is completed, left with a comment, or tagged \`${QUEST_NEEDS_ANSWER_TAG}\`, the run ends: read no new list. Review the pull request (below), then mark it ready for review: a blocked quest never holds back the ones that are done. Never merge it yourself, and never push to main. If the project's AGENTS.md or CLAUDE.md lets an agent turn on auto-merge, turn it on, as a rebase merge, so main receives one commit per quest. Otherwise it waits for review. A review fix goes into the commit of the quest it belongs to.
2. If you are still there once it has merged: a rebase gives every commit a new sha, so record for each quest the commit main received with \`quest_commit_add\` (find it in main's log by the quest's reference). Delete the branch locally, and on the remote if the merge did not, and remove the worktree.

Never stop with a quest you accepted still in progress: complete it, or leave it with a comment on why it cannot be done as written and hand it back with \`quest_unassign\`. If the pull request has not merged when you stop, say so in your reply with its link: its quests are completed, but not on main yet.

## Then report in your reply

- **What shipped**, in a few lines: the quests completed, the pull request, and whether it has merged.
- **Every quest you could not do as written**, numbered, one block each: what it asked, what stopped you, and the two or three ways forward with the one you would take. The decision is the owner's, and they are reading here.

If nothing was blocked, say so in one line rather than padding the list.

${reviewStepRule}

${visualCheckRule}

${unfinishedQuestRule}`;
