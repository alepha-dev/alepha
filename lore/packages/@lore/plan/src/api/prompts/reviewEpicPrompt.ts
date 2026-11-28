/**
 * `review-epic` (#E174): an epic's plan reviewed while it is still open,
 * its findings filed as one review. Its arg accepts a draft or ready epic.
 *
 * ⚠️ English, never localized: its words name the tools it calls. No
 * secret ever goes in: it leaves Lore on a clipboard or in a job.
 */
export const reviewEpicPromptText = `Review the plan of epic {{epic.reference}} "{{epic.title}}" in the Lore project "{{project}}".

The epic: {{epic.url}}

## Read it first

If you have the Lore MCP, use it:

- \`epic_get\` with project_name "{{project}}" and number {{epic.number}} for the epic's own body, and its \`review\`: the questions earlier reviews left open, and the decision log. The log is binding: do not ask again a question it answers, and do not reverse a decision in it without filing a new decision item that says so and why.
- \`quest_list\` with the same project, \`epic: {{epic.id}}\`, and \`detail: "full"\`. ⚠️ Without \`detail: "full"\` the list omits every description and every objective, which is exactly what a review has to read. Read the quests one by one if you prefer.

If you do not have it, open the URL above and read the epic and its quests there.

## The job

Nobody has started this epic yet (it is a \`draft\` or \`ready\`), which means its plan is open and its quest set can still change. Your job is to make it a plan worth executing:

1. **Take every decision the spec has left open.** Where it says "either X or Y", pick one and say why. Where it names a trade-off and does not resolve it, resolve it.
2. **Sharpen the quests that are vague.** A quest whose objectives could be ticked by two different pieces of work is not specified yet. Look for ordering that is implied but not written down, and for work that is named nowhere.
3. **Say plainly which questions you cannot answer alone.** A question asked is worth more than an answer invented. Do not guess at a decision that is the owner's to make, and do not quietly widen the scope.

Check the plan against the code as it actually is, not as the spec describes it. A spec written days ago may name a file, a function or a behaviour that has since moved.

## Write back what you find

- \`epic_update\` for the epic's own description.
- \`quest_create\` with \`epic_number\` {{epic.number}} for work the plan is missing. The epic's quests are drafts while it is a \`draft\`, and become to do together when the owner marks it ready: nothing is to be done to them one by one, and a quest filed into it while it is a draft is a draft too.
- \`quest_update\` to sharpen a quest's title, description or objectives, and \`quest_objective_set\` to tick one.
- A folio, filed under this epic, if the review produces a design note worth keeping (\`folio_create\` with \`epic_number\` {{epic.number}}). Pass \`directory_shortId\` too: browse the tree with \`directory_list\` from the root, and choose the directory that holds the epic's other folios, or else the deepest one its subject belongs to. Create a directory only when none fits. Never leave it at the root, and never file it in a trash directory.

Then file the review itself with ONE \`epic_review_create\` call (project_name "{{project}}", number {{epic.number}}), holding every item:

- a \`blocker\` for each problem that stops the plan as written (a premise the code contradicts, a dependency that is gone, a quest that cannot be done in this epic): shaped like a question, with its \`context\` and \`suggestions\`. File a blocker rather than a question when the epic should not be marked ready until it is resolved; a question is for a choice the plan can go either way on;
- a \`question\` for each one the owner has to answer: its title in one sentence, its \`context\`, its \`suggestions\` (each with its cost) and the one you \`recommended\`;
- a \`decision\` for each call you took alone, with its reason in \`context\`;
- a \`change\` for each edit above (the epic description, a quest created or sharpened), with its \`target\`.

The call returns the number each item was given. Numbers are per epic and continue across reviews, so use the returned ones, never your own count. If the review found nothing to ask, decide or change, file it with no items: an empty review is a record that the plan was read.

## Then put every open question in your reply

Filing them is not the report. The person who asked for this review is reading your answer, not the epic, and a bare list of questions hands the whole job straight back to them. End your reply with one numbered block per open blocker, then per open question, blockers first and marked as such, and for each one:

- **The question**, in a single sentence.
- **Context**: what the spec says, what the code actually does today, and why the two together do not settle it. Name the files.
- **Suggestions**: the two or three answers genuinely on the table, what each one costs, and which one you would take and why.

Number each block with the item number \`epic_review_create\` returned for that question. Close with how to answer: on the epic's Review tab first; or, when someone is reading this conversation, here ("answer 3: B", "waive 4"), which you then record with \`epic_review_answer\` (by item number: a letter is a \`suggestion\`, A being 0 and B being 1; their own words are an \`answer\`; "waive" is \`waive: true\`). Give each block's suggestions as A, B, C in that order. If the review raised no open question at all, say so in one line rather than inventing one.`;
