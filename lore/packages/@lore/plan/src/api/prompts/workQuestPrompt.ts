import { reviewStepRule } from "./reviewStepRule.ts";
import { unfinishedQuestRule } from "./unfinishedQuestRule.ts";

/**
 * `work-quest` (#E174): one quest, one branch, one pull request, one
 * commit. Its arg accepts a quest to do or in progress.
 *
 * ⚠️ English, never localized: its words name the tools it calls. No
 * secret ever goes in: it leaves Lore on a clipboard or in a job.
 */
export const workQuestPromptText = `Work on quest {{quest.reference}} "{{quest.title}}" of the Lore project "{{project}}".

The quest: {{quest.url}}

## Read it first

- \`quest_get\` with project_name "{{project}}" and shortId {{quest.number}}: the description, the objectives, the discussion, the linked feedback and the quest it depends on. If it belongs to an epic, \`epic_get\` that epic and read the folios filed under it; they hold the decisions already taken.
- If you do not have the Lore MCP, open the URL above and read the quest there.

## The job

1. Work in a git worktree of your own, on a branch cut from the latest main and named after the quest. Never on main, and never in the primary checkout: other sessions share it.
2. \`quest_accept\` it.
3. Do exactly what the quest and its objectives say. Tick each objective with \`quest_objective_set\` as it is met. Anything you discover beyond the quest is a comment (\`quest_comment_add\`), not extra scope.
4. Run the project's local checks (its AGENTS.md or CLAUDE.md names them) and fix everything red. A skipped check is a failure, not a pass.
5. Commit it as one commit, its message naming {{quest.reference}}. One quest is one commit: the pull request is rebase-merged, so main receives its commits as they are. A later fix goes into that commit (amend it, then push with \`--force-with-lease\`).
6. Push the branch and open a pull request into main. Its title names {{quest.reference}}, and its description links the quest. Record it on the quest with \`quest_pull_request_add\` (its URL, number and title), rather than posting its link as a comment.
7. If the project verifies on CI, the run on the pull request is the source of truth and a green local check is not: wait for it, or carry on with something else and read it when it lands. Fix and push again until it is green.
8. Never merge it yourself, and never push to main: the pull request is how the change lands. Review it first (below). If the project's AGENTS.md or CLAUDE.md lets an agent turn on auto-merge, turn it on once the review's fixes are pushed, as a rebase merge. Otherwise it waits for review.
9. Complete the quest now, in this run: do not wait for the CI run or the merge. \`quest_complete\` with a short note: what shipped, what was left out and why, and the pull request. Completing it says the work is done, not that it has shipped. Do not record the branch's sha: the rebase merge replaces it. A fix after that, for a red run or a review, still goes into the quest's one commit.
10. If you are still there once it has merged, record the commit main received with \`quest_commit_add\` (find it in main's log by {{quest.reference}}). Delete the branch locally, and on the remote if the merge did not, and remove the worktree.

Never stop with the quest still accepted: complete it, or, when you stop on a question below, hand it back with \`quest_unassign\` once the question is written. If the pull request has not merged when you stop, say so in your reply, with its link: the quest is completed, and not on main yet.

If the quest cannot be done as written, say so in a comment and stop. Do not guess at a decision that is the owner's to make, and put the question in your reply as well: what the quest asks, what stopped you, and the two or three ways forward with the one you would take. The comment is the record; your reply is what the person who sent you here reads.

${reviewStepRule}

${unfinishedQuestRule}`;
