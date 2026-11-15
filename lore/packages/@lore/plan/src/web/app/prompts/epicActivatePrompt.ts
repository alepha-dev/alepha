/**
 * The built-in default for `epicActivate`: Agent Prompts > Work on it,
 * offered on a ready or an in-progress epic.
 *
 * It sets no status (#Q2223). Its first `quest_accept` is what moves a ready
 * epic to `in_progress`, and closing the last quest is what completes it.
 * Until then this prompt told the agent to Begin the epic itself and to
 * Conclude it after the merge, which is exactly why neither click was a
 * decision. Not offered on a draft epic: its quests refuse to be accepted,
 * and whether a spec is done is the owner's call, so the prompt says to stop
 * rather than to flip it. Offered on an in-progress epic too, because a
 * half-worked epic can be handed over.
 *
 * Since #E121 it reads the epic's review record too: the decision log
 * `epic_get` inlines is binding beside the folios, and an open review
 * question is the owner's, so the run stops and reports it.
 *
 * ⚠️ **One branch and one pull request per quest, never a merge by the agent
 * (#Q3633).** Until then the epic ran on one branch, gated on the project's
 * full local check, and the agent merged it into main once at the end; #Q2640
 * had kept CI off the branch to save billed runs. The standard flow costs a CI
 * run per quest and buys what the old one could not: main only ever receives
 * a change that passed, an epic lands as one squash commit per quest, and a
 * bad quest is reverted alone. A quest that needs an earlier one still in
 * review waits for it rather than stacking on its branch: a quest completes
 * on its merge, and `quest_accept` refuses a quest whose dependency is not
 * completed, so a stacked branch could not even be accepted.
 *
 * What an agent cannot guess is filled in: which calls read the plan, what
 * the frozen quest set forbids once the epic has started, and what to do
 * when a quest cannot be done as written.
 *
 * ⚠️ It names `folio_create`, which belongs to the Remember capability, so
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

- Work in a git worktree of your own, with one branch and one pull request per quest. Never on main.
- Read the epic with \`epic_get\` (project_name "{{project}}", number {{number}}) and its quests with \`quest_list\` (\`epic: {{id}}\`, \`detail: "full"\`). Read the folios \`epic_get\` lists, and its \`review.log\`: together they hold the decisions already taken, and the log is binding.
- If \`epic_get\` lists any \`review.openBlockers\` or \`review.openQuestions\`, they are the owner's: stop and report them in your reply, blockers first, numbered as the review numbered them, rather than answering one yourself or working around it.
- The epic must be \`ready\` or \`in_progress\`. If it is still a \`draft\`, stop and say so: its plan is not finished, and marking it ready is the owner's call, not yours.
- Your first \`quest_accept\` starts the epic, and from then on its quest set is frozen. Anything you discover is an objective on a quest in the epic (\`quest_update\`) or a comment (\`quest_comment_add\`), never a new quest.
- Order the quests by their dependencies and by the order the epic's description gives.

## Each quest, one at a time

1. \`quest_accept\` it. Its objectives and its discussion are the contract.
2. Cut a branch for it from the latest main, named after the quest. If it builds on a quest whose pull request has not merged yet, take another quest meanwhile, or wait for that merge: stacking unmerged branches turns every squash merge into a rebase.
3. Do the work. Tick each objective with \`quest_objective_set\` as it is met, not at the end.
4. Run the project's local checks (its AGENTS.md or CLAUDE.md names them) and fix everything red before moving on. A skipped check is a failure, not a pass.
5. Commit, every message naming the quest and {{reference}}. Several commits are fine: the pull request is squash-merged, so main gets one commit per quest.
6. Push the branch and open a pull request into main. Its title names the quest and {{reference}}, since a squash merge makes it the commit message on main, and its description links the quest. Post the pull request's link on the quest with \`quest_comment_add\`.
7. If the project verifies on CI, the run on the pull request is the source of truth and a green local check is not. Fix and push again until it is green.
8. Never merge it yourself, and never push to main: the pull request is how the change lands. If the project's AGENTS.md or CLAUDE.md lets an agent turn on auto-merge, turn it on, as a squash merge. Otherwise it waits for review.
9. Only once it has merged: record the commit main received with \`quest_commit_add\` (a squash merge makes a new one), then \`quest_complete\` with a short note: what shipped, and anything the next quest needs to know.

Do not start the next quest while the current one is red. A green pull request waiting for its merge does not hold you up.

## After the last quest

1. Wait until every quest's pull request has merged and its quest is completed. A pull request still waiting for review when you stop leaves its quest accepted: name it in your reply.
2. Delete the merged branches locally, and on the remote where the merge did not, and remove the worktree.
3. File an outcome folio under the epic (\`folio_create\` with \`epic_number\` {{number}}): what shipped, where it diverged from the plan and why, what was left. It lands in the directory of the epic's other folios; pass \`directory_shortId\` only to put it somewhere else.

There is no status to set: the epic completed on its own when its last open quest was completed or shelved.

When a quest cannot be done as written, say so in a comment on it and move on to one that can. Do not guess at a decision that is the owner's to make.

## Then report in your reply

The outcome folio is the record; your reply is what the person who started this run reads. End it with:

- **What shipped**, in a few lines: the quests completed, each one's pull request, and which have merged.
- **Every quest you could not do as written**, numbered, one block each: what it asked, what stopped you, and the two or three ways forward with the one you would take. A pointer to the comment you left on that quest is not this. The decision is the owner's, and they are reading here.

If nothing was blocked, say so in one line rather than padding the list.`;
