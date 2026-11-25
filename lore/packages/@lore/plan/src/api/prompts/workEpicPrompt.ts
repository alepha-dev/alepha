import { QUEST_NEEDS_ANSWER_TAG } from "../schemas/questPresets.ts";
import { reviewStepRule } from "./reviewStepRule.ts";
import { unfinishedQuestRule } from "./unfinishedQuestRule.ts";

/**
 * `work-epic` (#E174): an epic worked to completion, one pull request,
 * one commit per quest. Its arg accepts a ready or in-progress epic.
 *
 * ⚠️ English, never localized: its words name the tools it calls. No
 * secret ever goes in: it leaves Lore on a clipboard or in a job.
 */
export const workEpicPromptText = `Work epic {{epic.reference}} "{{epic.title}}" of the Lore project "{{project}}" to completion, quest by quest, in one pull request.

The epic: {{epic.url}}

## Before touching code

- Work in a git worktree of your own, on one branch for the whole epic, cut from the latest main and named after the epic. Never on main. The epic lands as one pull request holding one commit per quest.
- Read the epic with \`epic_get\` (project_name "{{project}}", number {{epic.number}}) and its quests with \`quest_list\` (\`epic: {{epic.id}}\`, \`detail: "full"\`). Read the folios \`epic_get\` lists, and its \`review.log\`: together they hold the decisions already taken, and the log is binding.
- If \`epic_get\` lists any \`review.openBlockers\` or \`review.openQuestions\`, they are the owner's: stop and report them in your reply, blockers first, numbered as the review numbered them, rather than answering one yourself or working around it.
- The epic must be \`ready\` or \`in_progress\`. If it is still a \`draft\`, stop and say so: its plan is not finished, and marking it ready is the owner's call, not yours.
- Your first \`quest_accept\` starts the epic, and from then on its quest set is frozen. Anything you discover is an objective on a quest in the epic (\`quest_update\`) or a comment (\`quest_comment_add\`), never a new quest.
- Order the quests by their dependencies and by the order the epic's description gives.

## Each quest, one at a time

An epic is worked whole: every quest of the epic is worked, whatever its tags.

1. \`quest_accept\` it. Its objectives and its discussion are the contract.
2. Do the work. Tick each objective with \`quest_objective_set\` as it is met, not at the end.
3. Run the project's local checks (its AGENTS.md or CLAUDE.md names them) and fix everything red before moving on. A skipped check is a failure, not a pass.
4. Commit it as one commit, its message naming the quest and {{epic.reference}}. One quest is one commit: a later fix to this quest goes into its commit (a fixup, squashed into it before you push), never into another quest's.
5. Push the branch. After the first quest, open a pull request into main for the whole epic, as a draft: its title names {{epic.reference}}, and its description links the epic and lists its quests. Record it once on the epic with \`epic_pull_request_add\` (project_name "{{project}}", number {{epic.number}}, its URL, number and title): every quest of the epic shows the epic's pull request, so it is never posted on each quest.
6. \`quest_complete\` it with a short note: what shipped, and anything the next quest needs to know. A quest that depends on it can then be accepted. The epic's last quest completes the same way, and completing it completes the epic: that says its work is done, not that it has shipped. Do not record the branch's shas: the rebase merge replaces them.

If the project verifies on CI, every push runs it on the pull request, and that run is the source of truth: a green local check is not. Do not wait for it before starting the next quest, but read each run as it lands, and fix a red one in the commit of the quest it belongs to before going on.

If main moves and the pull request conflicts, rebase the branch onto the latest main and push with \`--force-with-lease\`. Never merge main into it: a merge commit breaks one commit per quest.

## After the last quest

The last quest is the last one you can work: a quest you left with a comment on why it cannot be done as written, or tagged \`${QUEST_NEEDS_ANSWER_TAG}\`, stays open and does not hold the pull request back.

1. Review the pull request (below), then mark it ready for review. Never merge it yourself, and never push to main. If the project's AGENTS.md or CLAUDE.md lets an agent turn on auto-merge, turn it on, as a rebase merge, so main receives one commit per quest. Otherwise it waits for review. A review fix goes into the commit of the quest it belongs to.
2. File an outcome folio under the epic (\`folio_create\` with \`epic_number\` {{epic.number}}): what shipped, where it diverged from the plan and why, what was left. Pass \`directory_shortId\` too: browse the tree with \`directory_list\` from the root, and choose the directory that holds the epic's other folios, or else the deepest one its subject belongs to. Create a directory only when none fits. Never leave it at the root, and never file it in a trash directory.
3. If you are still there once it has merged: a rebase gives every commit a new sha, so record for each quest the commit main received with \`quest_commit_add\` (find it in main's log by the quest's reference). Delete the branch locally, and on the remote if the merge did not, and remove the worktree.

There is no status to set: the epic completed on its own when its last open quest was completed or shelved. Never stop with a quest you accepted still open, unless you stop on an owner's question above. If the pull request has not merged when you stop, say so in your reply with its link: the epic is completed, and not on main yet.

When a quest cannot be done as written, say so in a comment on it and move on to one that can. Do not guess at a decision that is the owner's to make.

## Then report in your reply

The outcome folio is the record; your reply is what the person who started this run reads. End it with:

- **What shipped**, in a few lines: the quests completed, the pull request, and whether it has merged.
- **Every quest you could not do as written**, numbered, one block each: what it asked, what stopped you, and the two or three ways forward with the one you would take. A pointer to the comment you left on that quest is not this. The decision is the owner's, and they are reading here.

If nothing was blocked, say so in one line rather than padding the list.

${reviewStepRule}

${unfinishedQuestRule}`;
