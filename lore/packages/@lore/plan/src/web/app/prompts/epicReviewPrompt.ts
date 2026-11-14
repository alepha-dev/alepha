/**
 * The built-in default for `epicReview`: Agent Prompts > Review, offered on
 * an epic whose plan is still open, `draft` or `ready`.
 *
 * A template, not a builder. It is what a project gets before anyone edits
 * it in Settings > Quests > Agent prompts, and what Reset restores. The placeholders are the
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
 *
 * ⚠️ **The last section is about the REPLY, not about Lore, and it is the
 * point of the prompt.** The baseline used to stop at the write-back: the
 * questions landed on a quest or in the epic's description and the agent
 * answered "filed", which is a receipt, not a review. Every use of it then
 * began with the same follow-up asking for the context and a
 * recommendation on each question. Asking once, here, is what stops that.
 * A question filed with no context and no candidate answers hands the
 * whole job back to the reader.
 *
 * ⚠️ **The findings are a record since #E121**: ONE `epic_review_create`
 * call files every question, decision and change, and the reply quotes the
 * numbers it returned, so "answer 3: B" means the same item in chat and on
 * the Review tab. The decision log `epic_get` inlines is read first and is
 * binding. An empty review is filed, never padded.
 */
export const epicReviewPromptDefault = `Review the plan of epic {{reference}} "{{title}}" in the Lore project "{{project}}".

The epic: {{url}}

## Read it first

If you have the Lore MCP, use it:

- \`epic_get\` with project_name "{{project}}" and number {{number}} for the epic's own body, and its \`review\`: the questions earlier reviews left open, and the decision log. The log is binding: do not ask again a question it answers, and do not reverse a decision in it without filing a new decision item that says so and why.
- \`quest_list\` with the same project, \`epic: {{id}}\`, and \`detail: "full"\`. ⚠️ Without \`detail: "full"\` the list omits every description and every objective, which is exactly what a review has to read. Read the quests one by one if you prefer.

If you do not have it, open the URL above and read the epic and its quests there.

## The job

Nobody has started this epic yet (it is a \`draft\` or \`ready\`), which means its plan is open and its quest set can still change. Your job is to make it a plan worth executing:

1. **Take every decision the spec has left open.** Where it says "either X or Y", pick one and say why. Where it names a trade-off and does not resolve it, resolve it.
2. **Sharpen the quests that are vague.** A quest whose objectives could be ticked by two different pieces of work is not specified yet. Look for ordering that is implied but not written down, and for work that is named nowhere.
3. **Say plainly which questions you cannot answer alone.** A question asked is worth more than an answer invented. Do not guess at a decision that is the owner's to make, and do not quietly widen the scope.

Check the plan against the code as it actually is, not as the spec describes it. A spec written days ago may name a file, a function or a behaviour that has since moved.

## Write back what you find

- \`epic_update\` for the epic's own description.
- \`quest_create\` with \`epic_number\` {{number}} for work the plan is missing.
- \`quest_update\` to sharpen a quest's title, description or objectives, and \`quest_objective_set\` to tick one.
- A folio, filed under this epic, if the review produces a design note worth keeping.

Then file the review itself with ONE \`epic_review_create\` call (project_name "{{project}}", number {{number}}), holding every item:

- a \`question\` for each one the owner has to answer: its title in one sentence, its \`context\`, its \`suggestions\` (each with its cost) and the one you \`recommended\`;
- a \`decision\` for each call you took alone, with its reason in \`context\`;
- a \`change\` for each edit above (the epic description, a quest created or sharpened), with its \`target\`.

The call returns the number each item was given. Numbers are per epic and continue across reviews, so use the returned ones, never your own count. If the review found nothing to ask, decide or change, file it with no items: an empty review is a record that the plan was read.

## Then put every open question in your reply

Filing them is not the report. The person who asked for this review is reading your answer, not the epic, and a bare list of questions hands the whole job straight back to them. End your reply with one numbered block per open question, and for each one:

- **The question**, in a single sentence.
- **Context**: what the spec says, what the code actually does today, and why the two together do not settle it. Name the files.
- **Suggestions**: the two or three answers genuinely on the table, what each one costs, and which one you would take and why.

Number each block with the item number \`epic_review_create\` returned for that question. Close with how to answer: on the epic's Review tab, or here in chat ("answer 3: B", "waive 4"), which you then record with \`epic_review_answer\` (by item number: a letter is a \`suggestion\`, A being 0 and B being 1; their own words are an \`answer\`; "waive" is \`waive: true\`). Give each block's suggestions as A, B, C in that order. If the review raised no open question at all, say so in one line rather than inventing one.`;
