/**
 * The built-in default for `questLoop`: Agent Prompts > Work the loose
 * quests, offered on the Quests page toolbar.
 *
 * "Loose" is every quest in `todo` that belongs to no epic: the work an
 * epic's own Work on it never reaches. The rules are that prompt's, so a run
 * started here and a run started from an epic leave the same trail: one
 * worktree and one branch for the run, each quest accepted before its first
 * commit and named in every commit, completed when it lands, and one merge
 * at the end once CI is green.
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

- Work in a git worktree of your own, on one branch for the whole run. Never on main.
- Orient with \`project_context\` (project_name "{{project}}"), and read the repository's CLAUDE.md: it names the local checks.

## The loop

Repeat until no loose quest is left in \`todo\`. Re-read the list each round rather than taking it once at the start: quests get filed while you work, and finishing one often reveals the next.

To read it, call \`quest_list\` with status "todo" (page through it with \`limit\` and \`offset\` until you have every row) and keep the quests that carry no \`epic\`. A quest under an epic is not part of this run: an epic is worked through its own prompt.

Take the next one by priority, then by what the others depend on.

## Each quest

1. \`quest_get\` it. Its objectives and its discussion are the contract. Check its premise against the code before changing anything: if it is already done or no longer applies, complete it with those objectives waived and say why.
2. \`quest_accept\` it before its first commit.
3. Do the work. Tick each objective with \`quest_objective_set\` as it is met, not at the end.
4. Run the project's local checks and fix everything red. A skipped check is a failure, not a pass.
5. Commit, naming the quest in the message. Record the sha with \`quest_commit_add\`.
6. Push the branch and read the CI run before pushing the next quest: a failure then names the quest that caused it. If the project verifies on CI, that run is the source of truth and a green local check is not.
7. \`quest_complete\` with a short note: what shipped, and what was left out.

When a quest cannot be done as written, say so in a comment on it (\`quest_comment_add\`) and move on to one that can. Do not guess at a decision that is the owner's to make.

## When none is left

1. Read the list one last time. If it is empty, make sure the last CI run is green.
2. Merge the branch into main and push, then delete the branch locally and on the remote, and remove the worktree.

## Then report in your reply

- **What shipped**, in a few lines: the quests completed, the branch, and whether it is merged.
- **Every quest you could not do as written**, numbered, one block each: what it asked, what stopped you, and the two or three ways forward with the one you would take. The decision is the owner's, and they are reading here.

If nothing was blocked, say so in one line rather than padding the list.`;
