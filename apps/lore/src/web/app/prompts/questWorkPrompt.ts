/**
 * The built-in default for `questWork`: Agent Prompts > Work on it, offered
 * on a quest that is not completed and whose epic, if it has one, is active
 * or absent.
 *
 * Narrower than {@link epicActivatePromptDefault} on purpose: one quest, one
 * branch, one commit, and anything discovered beyond it is a comment rather
 * than extra scope.
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
 * is not Alepha. The shape - local checks are the inner loop, the CI run is
 * the source of truth, the branch is finished only once it is green - is what
 * generalises, so that is what the template states.
 */
export const questWorkPromptDefault = `Work on quest {{reference}} "{{title}}" of the Lore project "{{project}}".

The quest: {{url}}

## Read it first

- \`quest_get\` with project_name "{{project}}" and shortId {{number}}: the description, the objectives, the discussion, the linked feedback and the quest it depends on. If it belongs to an epic, \`epic_get\` that epic and read the folios filed under it; they hold the decisions already taken.
- If you do not have the Lore MCP, open the URL above and read the quest there.

## The job

1. Work in a git worktree of your own, on a branch named after the quest. Never on main, and never in the primary checkout: other sessions share it.
2. \`quest_accept\` it.
3. Do exactly what the quest and its objectives say. Tick each objective with \`quest_objective_set\` as it is met. Anything you discover beyond the quest is a comment (\`quest_comment_add\`), not extra scope.
4. Run the project's local checks (its CLAUDE.md names them) and fix everything red. A skipped check is a failure, not a pass.
5. Commit, one commit, its message naming {{reference}}. Record the sha with \`quest_commit_add\`.
6. Push the branch. If the project verifies on CI, that run is the source of truth and a green local check is not: wait for it, or carry on with something else and read it when it lands. Fix and push again until it is green.
7. Only when it is green, finish the branch: merge the branch into main and push, then delete the branch locally and on the remote, and remove the worktree.
8. \`quest_complete\` with a short note: what shipped, and what was left out and why.

If the quest cannot be done as written, say so in a comment and stop. Do not guess at a decision that is the owner's to make, and put the question in your reply as well: what the quest asks, what stopped you, and the two or three ways forward with the one you would take. The comment is the record; your reply is what the person who sent you here reads.`;
