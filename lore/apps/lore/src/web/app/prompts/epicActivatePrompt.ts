/**
 * The built-in default for `epicActivate`: Agent Prompts > Work on it,
 * offered on a ready or an in-progress epic.
 *
 * It sets no status (#Q2223). Its first `quest_accept` is what moves a ready
 * epic to `in_progress`, and closing the last quest is what completes it.
 * Until then this prompt told the agent to Begin the epic itself and to
 * Conclude it after the merge, which is exactly why neither click was a
 * decision. Not offered on a planned epic: its quests refuse to be accepted,
 * and whether a spec is done is the owner's call, so the prompt says to stop
 * rather than to flip it. Offered on an in-progress epic too, because a
 * half-worked epic can be handed over.
 *
 * What an agent cannot guess is filled in: which calls read the plan, what
 * the frozen quest set forbids once the epic has started, and what to do
 * when a quest cannot be done as written.
 *
 * ⚠️ It names `folio_create`, which belongs to the Knowledge capability, so
 * on a project with Work on and Knowledge off the last step is refused by
 * the capability gate. Left as it is rather than branched on: the template
 * is editable, and the prompt already says to stop and comment rather than
 * guess.
 *
 * ⚠️ **The closing section is about the REPLY, and it is not the outcome
 * folio.** The folio is the record a later session reads; the reply is what
 * the person who started the run reads now. A long run accumulates blocked
 * quests, each one a decision that is the owner's to make, and a comment
 * left on a quest somewhere inside a twelve-quest epic is not where they
 * are looking. Same defect the epic-review template had, from the other
 * end: there the questions were filed, here they would be scattered.
 *
 * See {@link epicReviewPromptDefault} for why this text is English and
 * carries no secrets.
 */
export const epicActivatePromptDefault = `Work epic {{reference}} "{{title}}" of the Lore project "{{project}}" to completion, quest by quest.

The epic: {{url}}

## Before touching code

- Work in a git worktree of your own, on a branch named after the epic. Never on main.
- Read the epic with \`epic_get\` (project_name "{{project}}", number {{number}}) and its quests with \`quest_list\` (\`epic: {{id}}\`, \`detail: "full"\`). Read the folios \`epic_get\` lists: they hold the decisions already taken.
- The epic must be \`ready\` or \`in_progress\`. If it is still \`planned\`, stop and say so: its plan is not finished, and marking it ready is the owner's call, not yours.
- Your first \`quest_accept\` starts the epic, and from then on its quest set is frozen. Anything you discover is an objective on a quest in the epic (\`quest_update\`) or a comment (\`quest_comment_add\`), never a new quest.
- Order the quests by their dependencies and by the order the epic's description gives.

## Each quest, one at a time

1. \`quest_accept\` it. Its objectives and its discussion are the contract.
2. Do the work. Tick each objective with \`quest_objective_set\` as it is met, not at the end.
3. Run the project's local checks (its CLAUDE.md names them) and fix everything red before moving on. A skipped check is a failure, not a pass.
4. Commit, one commit for the quest, its message naming {{reference}} and the quest. Record the sha with \`quest_commit_add\`.
5. \`quest_complete\` with a short note: what shipped, and anything the next quest needs to know.

Do not start the next quest while the current one is red.

Push the branch as you go rather than only at the end. If the project verifies on CI, that run is the source of truth and a green local check is not; pushing after each quest means a failure names the quest that caused it, instead of arriving at the end attached to the whole epic. You do not have to wait for it before starting the next quest.

## After the last quest

1. Push, and wait for CI this time. Fix and push again until it is green.
2. Only when it is green: merge the branch into main and push, then delete the branch locally and on the remote, and remove the worktree.
3. File an outcome folio under the epic (\`folio_create\` with \`epic_number\` {{number}}): what shipped, where it diverged from the plan and why, what was left.

There is no status to set: the epic completed on its own when its last open quest was completed or shelved.

When a quest cannot be done as written, say so in a comment on it and move on to one that can. Do not guess at a decision that is the owner's to make.

## Then report in your reply

The outcome folio is the record; your reply is what the person who started this run reads. End it with:

- **What shipped**, in a few lines: the quests completed, the branch, and whether it is merged.
- **Every quest you could not do as written**, numbered, one block each: what it asked, what stopped you, and the two or three ways forward with the one you would take. A pointer to the comment you left on that quest is not this. The decision is the owner's, and they are reading here.

If nothing was blocked, say so in one line rather than padding the list.`;
