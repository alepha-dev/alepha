/**
 * The built-in default for `epicActivate`: Agent Prompts > Activate, offered
 * on a planned or an active epic.
 *
 * Activate is not Begin. Begin is the epic's own lifecycle action and stays
 * where it is; this hands the whole epic to an agent, which begins it if
 * needed. Offered on an active epic too, because a half-worked epic can be
 * handed over.
 *
 * What an agent cannot guess is filled in: which calls read the plan, what
 * the frozen quest set forbids once the epic is active, and what to do when
 * a quest cannot be done as written.
 *
 * ⚠️ It names `folio_create`, which belongs to the Knowledge capability, so
 * on a project with Work on and Knowledge off the last step is refused by
 * the capability gate. Left as it is rather than branched on: the template
 * is editable, and the prompt already says to stop and comment rather than
 * guess.
 *
 * See {@link epicReviewPromptDefault} for why this text is English and
 * carries no secrets.
 */
export const epicActivatePromptDefault = `Work epic {{reference}} "{{title}}" of the Lore project "{{project}}" to completion, quest by quest.

The epic: {{url}}

## Before touching code

- Work in a git worktree of your own, on a branch named after the epic. Never on main.
- Read the epic with \`epic_get\` (project_name "{{project}}", number {{number}}) and its quests with \`quest_list\` (\`epic: {{id}}\`, \`detail: "full"\`). Read the folios \`epic_get\` lists: they hold the decisions already taken.
- If the epic is still \`planned\`, begin it: \`epic_set_status\` "active". From then on its quest set is frozen. Anything you discover is an objective on a quest in the epic (\`quest_update\`) or a comment (\`quest_comment_add\`), never a new quest.
- Order the quests by their dependencies and by the order the epic's description gives.

## Each quest, one at a time

1. \`quest_accept\` it. Its objectives and its discussion are the contract.
2. Do the work. Tick each objective with \`quest_objective_set\` as it is met, not at the end.
3. Run the project's verification commands (its CLAUDE.md names them) and fix everything red before moving on. A skipped check is a failure, not a pass.
4. Commit, one commit for the quest, its message naming {{reference}} and the quest. Record the sha with \`quest_commit_add\`.
5. \`quest_complete\` with a short note: what shipped, and anything the next quest needs to know.

Do not start the next quest while the current one is red.

## After the last quest

1. Run the full verification pipeline once more on the whole branch.
2. Merge the branch into main and push.
3. Conclude the epic: \`epic_set_status\` "done".
4. File an outcome folio under the epic (\`folio_create\` with \`epic_number\` {{number}}): what shipped, where it diverged from the plan and why, what was left.

When a quest cannot be done as written, say so in a comment on it and move on to one that can. Do not guess at a decision that is the owner's to make.`;
