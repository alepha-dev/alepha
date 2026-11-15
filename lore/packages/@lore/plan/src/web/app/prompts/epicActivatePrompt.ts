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
 * ⚠️ **One branch and one pull request for the whole epic, one commit per
 * quest, rebase-merged, never merged by the agent (#Q3706).** History:
 * until #Q3633 the epic ran on one branch and the agent merged it into main
 * itself, after a local check only. #Q3633 made it a pull request per quest,
 * squash-merged: main only received what passed CI, but every quest waited
 * for its own CI run and merge before the next could start, and on
 * 2026-11-15 two epics spent most of a night doing that. Now the epic is one
 * draft pull request, pushed after every quest so CI runs while the next
 * quest is worked, and merged by rebase so main still gets one commit per
 * quest and a bad quest can still be reverted alone.
 *
 * ⚠️ **A quest completes once its commit is pushed, not on the merge.**
 * `quest_accept` refuses a quest whose dependency is not completed, so a
 * quest that waited for the epic's merge would block every quest after it.
 * The LAST quest is the exception: completing it completes the epic, so it
 * waits for the merge, and the epic completes only once it has landed. A
 * rebase gives every commit a new sha, so the shas are recorded after the
 * merge, from main's log.
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
export const epicActivatePromptDefault = `Work epic {{reference}} "{{title}}" of the Lore project "{{project}}" to completion, quest by quest, in one pull request.

The epic: {{url}}

## Before touching code

- Work in a git worktree of your own, on one branch for the whole epic, cut from the latest main and named after the epic. Never on main. The epic lands as one pull request holding one commit per quest.
- Read the epic with \`epic_get\` (project_name "{{project}}", number {{number}}) and its quests with \`quest_list\` (\`epic: {{id}}\`, \`detail: "full"\`). Read the folios \`epic_get\` lists, and its \`review.log\`: together they hold the decisions already taken, and the log is binding.
- If \`epic_get\` lists any \`review.openBlockers\` or \`review.openQuestions\`, they are the owner's: stop and report them in your reply, blockers first, numbered as the review numbered them, rather than answering one yourself or working around it.
- The epic must be \`ready\` or \`in_progress\`. If it is still a \`draft\`, stop and say so: its plan is not finished, and marking it ready is the owner's call, not yours.
- Your first \`quest_accept\` starts the epic, and from then on its quest set is frozen. Anything you discover is an objective on a quest in the epic (\`quest_update\`) or a comment (\`quest_comment_add\`), never a new quest.
- Order the quests by their dependencies and by the order the epic's description gives.

## Each quest, one at a time

1. \`quest_accept\` it. Its objectives and its discussion are the contract.
2. Do the work. Tick each objective with \`quest_objective_set\` as it is met, not at the end.
3. Run the project's local checks (its AGENTS.md or CLAUDE.md names them) and fix everything red before moving on. A skipped check is a failure, not a pass.
4. Commit it as one commit, its message naming the quest and {{reference}}. One quest is one commit: a later fix to this quest goes into its commit (a fixup, squashed into it before you push), never into another quest's.
5. Push the branch. After the first quest, open a pull request into main for the whole epic, as a draft: its title names {{reference}}, and its description links the epic and lists its quests. Post the pull request's link on each quest with \`quest_comment_add\` as you reach it.
6. \`quest_complete\` it with a short note: what shipped, and anything the next quest needs to know. A quest that depends on it can then be accepted. Keep the epic's last quest accepted until the pull request has merged: completing it completes the epic, and the epic has not landed yet.

If the project verifies on CI, every push runs it on the pull request, and that run is the source of truth: a green local check is not. Do not wait for it before starting the next quest, but read each run as it lands, and fix a red one in the commit of the quest it belongs to before going on.

If main moves and the pull request conflicts, rebase the branch onto the latest main and push with \`--force-with-lease\`. Never merge main into it: a merge commit breaks one commit per quest.

## After the last quest

1. Mark the pull request ready for review. Never merge it yourself, and never push to main. If the project's AGENTS.md or CLAUDE.md lets an agent turn on auto-merge, turn it on, as a rebase merge, so main receives one commit per quest. Otherwise it waits for review. A review fix goes into the commit of the quest it belongs to.
2. Only once it has merged: a rebase gives every commit a new sha, so record for each quest the commit main received with \`quest_commit_add\` (find it in main's log by the quest's reference), then \`quest_complete\` the last quest.
3. Delete the branch locally, and on the remote if the merge did not, and remove the worktree.
4. File an outcome folio under the epic (\`folio_create\` with \`epic_number\` {{number}}): what shipped, where it diverged from the plan and why, what was left. It lands in the directory of the epic's other folios; pass \`directory_shortId\` only to put it somewhere else.

There is no status to set: the epic completed on its own when its last open quest was completed or shelved. If the pull request has not merged when you stop, leave the last quest accepted and say so in your reply, with the pull request's link.

When a quest cannot be done as written, say so in a comment on it and move on to one that can. Do not guess at a decision that is the owner's to make.

## Then report in your reply

The outcome folio is the record; your reply is what the person who started this run reads. End it with:

- **What shipped**, in a few lines: the quests completed, the pull request, and whether it has merged.
- **Every quest you could not do as written**, numbered, one block each: what it asked, what stopped you, and the two or three ways forward with the one you would take. A pointer to the comment you left on that quest is not this. The decision is the owner's, and they are reading here.

If nothing was blocked, say so in one line rather than padding the list.`;
