/**
 * The built-in default for `questWork`: Agent Prompts > Work on it, offered
 * on a quest that is not completed and whose epic, if it has one, is active
 * or absent.
 *
 * Narrower than {@link epicActivatePromptDefault} on purpose: one quest, one
 * branch, one pull request, one commit, and anything discovered beyond it is
 * a comment rather than extra scope. A quest worked on its own is the third
 * of the three rules (#Q3706): an epic is one pull request, a run of loose
 * quests is one pull request, and any other quest is a pull request of its
 * own.
 *
 * ⚠️ **The agent opens a pull request and never merges it (#Q3633).** Until
 * then the prompt told it to merge the branch into main and push, so CI ran
 * after the change was already on main. Every default now takes the standard
 * route: a branch from the latest main, a pull request, CI on it, and a
 * rebase merge (#Q3706; a squash until then) of the quest's one commit.
 * Rebase rather than squash because the same project merges an epic's pull
 * request, one commit per quest, and one merge method serves both. Whether
 * an agent may turn on auto-merge is the project's rule, read from its AGENTS.md, never
 * assumed.
 *
 * ⚠️ **The quest completes in the run that pushes it, not on the merge
 * (#Q3982).** It waited for the merge until then, and the merge lands after
 * the agent's run has ended, with nothing to bring it back: the quest stayed
 * accepted until a person noticed. Completing a quest says the work is done,
 * not that it shipped; Lore reads where a quest is live from the references
 * in a deployment's history, never from its completion. The branch's sha is
 * not recorded, since the rebase merge replaces it; main's is, by whoever is
 * still there after the merge.
 *
 * ⚠️ **The closing paragraph's "and stop" carries the reply clause**, rather
 * than the template growing a report section of its own. There is exactly one
 * blocking point here, and what shipped is answered by the diff; the epic
 * templates need a section because they have many. See
 * {@link epicReviewPromptDefault} for the defect all three are avoiding,
 * and for why this text is English and carries no secrets.
 *
 * ⚠️ **Step 6 says "if the project verifies on CI" rather than naming a
 * command**, and step 4 says "the project's local checks" for the same
 * reason: this default is served to EVERY Lore project, not just the one it
 * was written in. Naming `yarn v` here would be wrong for every project that
 * is not Alepha. The shape - local checks are the inner loop, the CI run on
 * the pull request is the source of truth, nothing lands without it - is what
 * generalises, so that is what the template states. "Pull request" is the
 * generic word here: on a forge that calls it a merge request, an agent reads
 * it as one.
 *
 * The pull request is recorded with `quest_pull_request_add`, not posted as a link with
 * `quest_comment_add` (#Q3707): a link in the discussion is found by
 * scrolling, a record shows on the quest's rail.
 */
export const questWorkPromptDefault = `Work on quest {{reference}} "{{title}}" of the Lore project "{{project}}".

The quest: {{url}}

## Read it first

- \`quest_get\` with project_name "{{project}}" and shortId {{number}}: the description, the objectives, the discussion, the linked feedback and the quest it depends on. If it belongs to an epic, \`epic_get\` that epic and read the folios filed under it; they hold the decisions already taken.
- If you do not have the Lore MCP, open the URL above and read the quest there.

## The job

1. Work in a git worktree of your own, on a branch cut from the latest main and named after the quest. Never on main, and never in the primary checkout: other sessions share it.
2. \`quest_accept\` it.
3. Do exactly what the quest and its objectives say. Tick each objective with \`quest_objective_set\` as it is met. Anything you discover beyond the quest is a comment (\`quest_comment_add\`), not extra scope.
4. Run the project's local checks (its AGENTS.md or CLAUDE.md names them) and fix everything red. A skipped check is a failure, not a pass.
5. Commit it as one commit, its message naming {{reference}}. One quest is one commit: the pull request is rebase-merged, so main receives its commits as they are. A later fix goes into that commit (amend it, then push with \`--force-with-lease\`).
6. Push the branch and open a pull request into main. Its title names {{reference}}, and its description links the quest. Record it on the quest with \`quest_pull_request_add\` (its URL, number and title), rather than posting its link as a comment.
7. If the project verifies on CI, the run on the pull request is the source of truth and a green local check is not: wait for it, or carry on with something else and read it when it lands. Fix and push again until it is green.
8. Never merge it yourself, and never push to main: the pull request is how the change lands. If the project's AGENTS.md or CLAUDE.md lets an agent turn on auto-merge, turn it on, as a rebase merge. Otherwise it waits for review.
9. Complete the quest now, in this run: do not wait for the CI run or the merge. \`quest_complete\` with a short note: what shipped, what was left out and why, and the pull request. Completing it says the work is done, not that it has shipped. Do not record the branch's sha: the rebase merge replaces it. A fix after that, for a red run or a review, still goes into the quest's one commit.
10. If you are still there once it has merged, record the commit main received with \`quest_commit_add\` (find it in main's log by {{reference}}). Delete the branch locally, and on the remote if the merge did not, and remove the worktree.

Never stop with the quest still accepted, unless you stop on a question below. If the pull request has not merged when you stop, say so in your reply, with its link: the quest is completed, and not on main yet.

If the quest cannot be done as written, say so in a comment and stop. Do not guess at a decision that is the owner's to make, and put the question in your reply as well: what the quest asks, what stopped you, and the two or three ways forward with the one you would take. The comment is the record; your reply is what the person who sent you here reads.`;
