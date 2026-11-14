/**
 * The built-in default for `questLoop`: Agent Prompts > Work the loose
 * quests, offered on the Quests page toolbar.
 *
 * "Loose" is every quest in `todo` that belongs to no epic: the work an
 * epic's own Work on it never reaches. The rules are that prompt's, so a run
 * started here and a run started from an epic leave the same trail: one
 * worktree for the run, one branch and one pull request per quest (#Q3633),
 * each quest accepted before its first commit, named in every commit and in
 * its pull request's title, and completed when that pull request merges. The
 * agent never merges to main itself.
 *
 * ⚠️ **Surface-scoped**, like `feedbackLoop`: its subject is an
 * {@link AgentPromptProjectSubject}, so `{{reference}}`, `{{number}}`,
 * `{{id}}` and `{{title}}` must not appear below.
 *
 * ⚠️ **A loop, not a batch.** It re-reads the list each round, because
 * quests are filed during a run (a finished quest often reveals the next
 * one), and a list snapshotted at the start would end the run with work
 * nobody saw. `quest_list` has no "no epic" filter, so the prompt says how to
 * find them: status `todo`, then keep the rows that carry no `epic`.
 *
 * See {@link epicReviewPromptDefault} for why this text is English and
 * carries no secrets.
 */
export const questLoopPromptDefault = `Work every loose quest of the Lore project "{{project}}", one at a time, in one run: every quest in \`todo\` that belongs to no epic.

The quests: {{url}}

## Before touching code

- Work in a git worktree of your own, with one branch and one pull request per quest. Never on main.
- Orient with \`project_context\` (project_name "{{project}}"), and read the repository's AGENTS.md (or CLAUDE.md): it names the local checks.

## The loop

Repeat until no loose quest is left in \`todo\`. Re-read the list each round rather than taking it once at the start: quests get filed while you work, and finishing one often reveals the next.

To read it, call \`quest_list\` with status "todo" (page through it with \`limit\` and \`offset\` until you have every row) and keep the quests that carry no \`epic\`. A quest under an epic is not part of this run: an epic is worked through its own prompt.

Take the next one by priority, then by what the others depend on.

## Each quest

1. \`quest_get\` it. Its objectives and its discussion are the contract. Check its premise against the code before changing anything: if it is already done or no longer applies, complete it with those objectives waived and say why.
2. \`quest_accept\` it before its first commit.
3. Cut a branch for it from the latest main, named after the quest. If it builds on a quest whose pull request has not merged yet, take another one meanwhile, or wait for that merge.
4. Do the work. Tick each objective with \`quest_objective_set\` as it is met, not at the end.
5. Run the project's local checks and fix everything red. A skipped check is a failure, not a pass.
6. Commit, naming the quest in every message. Several commits are fine: the pull request is squash-merged, so main gets one commit per quest.
7. Push the branch and open a pull request into main. Its title names the quest, since a squash merge makes it the commit message on main, and its description links the quest. Post the pull request's link on the quest with \`quest_comment_add\`.
8. If the project verifies on CI, the run on the pull request is the source of truth and a green local check is not. Fix and push again until it is green.
9. Never merge it yourself, and never push to main: the pull request is how the change lands. If the project's AGENTS.md or CLAUDE.md lets an agent turn on auto-merge, turn it on, as a squash merge. Otherwise it waits for review.
10. Only once it has merged: record the commit main received with \`quest_commit_add\` (a squash merge makes a new one), then \`quest_complete\` with a short note: what shipped, and what was left out.

When a quest cannot be done as written, say so in a comment on it (\`quest_comment_add\`) and move on to one that can. Do not guess at a decision that is the owner's to make.

## When none is left

1. Read the list one last time. If it is empty, wait until every pull request of the run has merged and its quest is completed. One still waiting for review leaves its quest accepted: name it in your reply.
2. Delete the merged branches locally, and on the remote where the merge did not, and remove the worktree.

## Then report in your reply

- **What shipped**, in a few lines: the quests completed, each one's pull request, and which have merged.
- **Every quest you could not do as written**, numbered, one block each: what it asked, what stopped you, and the two or three ways forward with the one you would take. The decision is the owner's, and they are reading here.

If nothing was blocked, say so in one line rather than padding the list.`;
