import { PROMPT_NEEDS_HUMAN_TAG } from "@lore/core/schemas";

import { unfinishedQuestRule } from "./unfinishedQuestRule.ts";

/**
 * `work-loose-quests` (#E174): every quest under no epic, one pull
 * request for the run.
 *
 * ⚠️ English, never localized: its words name the tools it calls. No
 * secret ever goes in: it leaves Lore on a clipboard or in a job.
 */
export const workLooseQuestsPromptText = `Work every loose quest of the Lore project "{{project}}", one at a time, in one run and one pull request: every quest in \`todo\` that belongs to no epic and is not tagged \`${PROMPT_NEEDS_HUMAN_TAG}\`.

The quests: {{projectUrl}}/quests

## Before touching code

- Work in a git worktree of your own, on one branch for the whole run, cut from the latest main. Never on main. The run lands as one pull request holding one commit per quest.
- Orient with \`project_context\` (project_name "{{project}}"), and read the repository's AGENTS.md (or CLAUDE.md): it names the local checks.

## The loop

Repeat until no loose quest is left in \`todo\`. Re-read the list each round rather than taking it once at the start: quests get filed while you work, and finishing one often reveals the next.

To read it, call \`quest_list\` with status "todo" (page through it with \`limit\` and \`offset\` until you have every row) and keep the quests that carry no \`epic\` and no \`${PROMPT_NEEDS_HUMAN_TAG}\` tag: an agent does not build those alone. A quest under an epic is not part of this run: an epic is worked through its own prompt.

Take the next one by priority, then by what the others depend on.

## Each quest

1. \`quest_get\` it. Its objectives and its discussion are the contract. Check its premise against the code before changing anything: if it is already done or no longer applies, complete it with those objectives waived and say why.
2. \`quest_accept\` it before its first commit.
3. Do the work. Tick each objective with \`quest_objective_set\` as it is met, not at the end.
4. Run the project's local checks and fix everything red. A skipped check is a failure, not a pass.
5. Commit it as one commit, naming the quest in its message. One quest is one commit: a later fix to this quest goes into its commit (a fixup, squashed into it before you push), never into another quest's.
6. Push the branch. After the first quest, open a pull request into main for the run, as a draft: its title says it is a run of loose quests, and its description lists each quest with its link, kept up to date as the run goes. Record it on each quest with \`quest_pull_request_add\` (its URL, number and title) as you reach it, rather than posting its link as a comment.
7. \`quest_complete\` it with a short note: what shipped, and what was left out. A quest that depends on it can then be accepted.

If the project verifies on CI, every push runs it on the pull request, and that run is the source of truth: a green local check is not. Do not wait for it before starting the next quest, but read each run as it lands, and fix a red one in the commit of the quest it belongs to before going on.

If main moves and the pull request conflicts, rebase the branch onto the latest main and push with \`--force-with-lease\`. Never merge main into it: a merge commit breaks one commit per quest.

When a quest cannot be done as written, say so in a comment on it (\`quest_comment_add\`) and move on to one that can. Do not guess at a decision that is the owner's to make.

## When none is left

1. Read the list one last time. If it is empty, mark the pull request ready for review. Never merge it yourself, and never push to main. If the project's AGENTS.md or CLAUDE.md lets an agent turn on auto-merge, turn it on, as a rebase merge, so main receives one commit per quest. Otherwise it waits for review. A review fix goes into the commit of the quest it belongs to.
2. If you are still there once it has merged: a rebase gives every commit a new sha, so record for each quest the commit main received with \`quest_commit_add\` (find it in main's log by the quest's reference). Delete the branch locally, and on the remote if the merge did not, and remove the worktree.

Never stop with a quest you accepted still open, unless you left it with a comment on why it cannot be done as written. If the pull request has not merged when you stop, say so in your reply with its link: its quests are completed, but not on main yet.

## Then report in your reply

- **What shipped**, in a few lines: the quests completed, the pull request, and whether it has merged.
- **Every quest you could not do as written**, numbered, one block each: what it asked, what stopped you, and the two or three ways forward with the one you would take. The decision is the owner's, and they are reading here.

If nothing was blocked, say so in one line rather than padding the list.

${unfinishedQuestRule}`;
