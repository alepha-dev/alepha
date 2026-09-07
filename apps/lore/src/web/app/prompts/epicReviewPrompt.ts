/**
 * The built-in default for `epicReview`: Agent Prompts > Review, offered on
 * a planned epic.
 *
 * A template, not a builder. It is what a project gets before anyone edits
 * it in Settings > Work, and what Reset restores. The placeholders are the
 * seven of {@link AgentPromptSubject}, substituted by
 * `renderPromptTemplate`.
 *
 * ⚠️ **The payload is English and is not localized.** Its words ARE the
 * tool names it calls, so translating it would break it. The button's
 * label and the toast around it are localized; this is not.
 *
 * ⚠️ **No secrets, ever.** This text leaves Lore through the clipboard and
 * lands wherever the reader pastes it. The renderer takes seven named
 * fields and not a resource object precisely so that nothing can ride
 * along.
 *
 * Two things changed from the text that shipped before the templates
 * existed: `quest_list` is told `epic: {{id}}`, the global id its filter
 * actually wants, rather than "set to that epic", which made the agent look
 * it up; and `{{project}}` is the project's TITLE, which is what
 * `project_name` matches.
 */
export const epicReviewPromptDefault = `Review the plan of epic {{reference}} "{{title}}" in the Lore project "{{project}}".

The epic: {{url}}

## Read it first

If you have the Lore MCP, use it:

- \`epic_get\` with project_name "{{project}}" and number {{number}} for the epic's own body.
- \`quest_list\` with the same project, \`epic: {{id}}\`, and \`detail: "full"\`. ⚠️ Without \`detail: "full"\` the list omits every description and every objective, which is exactly what a review has to read. Read the quests one by one if you prefer.

If you do not have it, open the URL above and read the epic and its quests there.

## The job

This epic is still \`planned\`, which means its plan is open and its quest set is still being written. Your job is to make it a plan worth executing:

1. **Take every decision the spec has left open.** Where it says "either X or Y", pick one and say why. Where it names a trade-off and does not resolve it, resolve it.
2. **Sharpen the quests that are vague.** A quest whose objectives could be ticked by two different pieces of work is not specified yet. Look for ordering that is implied but not written down, and for work that is named nowhere.
3. **Say plainly which questions you cannot answer alone.** A question asked is worth more than an answer invented. Do not guess at a decision that is the owner's to make, and do not quietly widen the scope.

Check the plan against the code as it actually is, not as the spec describes it. A spec written days ago may name a file, a function or a behaviour that has since moved.

## Write back what you find

- \`epic_update\` for the epic's own description.
- \`quest_create\` with \`epic_number\` {{number}} for work the plan is missing.
- \`quest_update\` to sharpen a quest's title, description or objectives, and \`quest_objective_set\` to tick one.
- A folio, filed under this epic, if the review produces a design note worth keeping.

Leave the open questions somewhere they will be read: a comment on the quest they concern, or a section in the epic's description.`;
