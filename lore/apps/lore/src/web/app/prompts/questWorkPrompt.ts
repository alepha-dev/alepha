/**
 * The built-in default for `questWork`: Agent Prompts > Work on it, offered
 * on a quest that is not completed and whose epic, if it has one, is active
 * or absent.
 *
 * Narrower than {@link epicActivatePromptDefault} on purpose: one quest, one
 * branch, one commit, and anything discovered beyond it is a comment rather
 * than extra scope.
 *
 * See {@link epicReviewPromptDefault} for why this text is English and
 * carries no secrets.
 */
export const questWorkPromptDefault = `Work on quest {{reference}} "{{title}}" of the Lore project "{{project}}".

The quest: {{url}}

## Read it first

- \`quest_get\` with project_name "{{project}}" and shortId {{number}}: the description, the objectives, the discussion, the linked feedback and the quest it depends on. If it belongs to an epic, \`epic_get\` that epic and read the folios filed under it; they hold the decisions already taken.
- If you do not have the Lore MCP, open the URL above and read the quest there.

## The job

1. Work in a git worktree of your own, on a branch named after the quest. Never on main.
2. \`quest_accept\` it.
3. Do exactly what the quest and its objectives say. Tick each objective with \`quest_objective_set\` as it is met. Anything you discover beyond the quest is a comment (\`quest_comment_add\`), not extra scope.
4. Run the project's verification commands (its CLAUDE.md names them) and fix everything red. A skipped check is a failure, not a pass.
5. Commit, one commit, its message naming {{reference}}. Record the sha with \`quest_commit_add\`.
6. Merge the branch into main and push.
7. \`quest_complete\` with a short note: what shipped, and what was left out and why.

If the quest cannot be done as written, say so in a comment and stop. Do not guess at a decision that is the owner's to make.`;
