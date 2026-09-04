/**
 * What the epic-review prompt needs in order to name its subject.
 *
 * Deliberately not an `EpicResource`: the prompt is plain text handed to an
 * outside agent, so what goes into it is chosen field by field rather than
 * inherited from whatever the resource happens to carry. See the secrets
 * note on the builder.
 */
export interface EpicReviewPromptInput {
  /** The project's URL slug, which is how MCP tools and the URL name it. */
  projectSlug: string;
  /** The epic's per-project number, the `#31` a reader recognises. */
  epicNumber: number;
  epicTitle: string;
  /** Absolute where there is a window, a path otherwise. */
  url: string;
}

/**
 * The prompt that Review puts on the clipboard, for Claude Code or Codex.
 *
 * Pure and plain text: no component state, no i18n. The prompt is addressed
 * to an agent working in English against an English MCP surface, and its
 * words ARE the tool names it has to call, so translating it would break it.
 * The button's label is localized; its payload is not.
 *
 * ⚠️ **No secrets, ever.** This text leaves Lore through the clipboard and
 * lands wherever the reader pastes it. The slug and the number are public
 * within the project; a sigil key, a session token or an API key must never
 * enter it. That is why the input above is four named fields and not a
 * resource object.
 *
 * The first of a set (feedback #2087), which is why it is a module with a
 * typed input rather than a string built inside a row-menu callback: the
 * second one would be copy-pasted from it, and then the two would drift.
 * Its unit spec pins the template so that a change to it is a diff someone
 * reads.
 */
export const buildEpicReviewPrompt = (input: EpicReviewPromptInput): string => {
  const ref = `#${input.epicNumber}`;
  return [
    `Review the plan of epic ${ref} "${input.epicTitle}" in the Lore project "${input.projectSlug}".`,
    ``,
    `The epic: ${input.url}`,
    ``,
    `## Read it first`,
    ``,
    `If you have the Lore MCP, use it:`,
    ``,
    `- \`epic_get\` with project_name "${input.projectSlug}" and number ${input.epicNumber} for the epic's own body.`,
    `- \`quest_list\` with the same project, \`epic\` set to that epic, and \`detail: "full"\`. ⚠️ Without \`detail: "full"\` the list omits every description and every objective, which is exactly what a review has to read. Read the quests one by one if you prefer.`,
    ``,
    `If you do not have it, open the URL above and read the epic and its quests there.`,
    ``,
    `## The job`,
    ``,
    `This epic is still \`planned\`, which means its plan is open and its quest set is still being written. Your job is to make it a plan worth executing:`,
    ``,
    `1. **Take every decision the spec has left open.** Where it says "either X or Y", pick one and say why. Where it names a trade-off and does not resolve it, resolve it.`,
    `2. **Sharpen the quests that are vague.** A quest whose objectives could be ticked by two different pieces of work is not specified yet. Look for ordering that is implied but not written down, and for work that is named nowhere.`,
    `3. **Say plainly which questions you cannot answer alone.** A question asked is worth more than an answer invented. Do not guess at a decision that is the owner's to make, and do not quietly widen the scope.`,
    ``,
    `Check the plan against the code as it actually is, not as the spec describes it. A spec written days ago may name a file, a function or a behaviour that has since moved.`,
    ``,
    `## Write back what you find`,
    ``,
    `- \`epic_update\` for the epic's own description.`,
    `- \`quest_create\` with \`epic_number\` ${input.epicNumber} for work the plan is missing.`,
    `- \`quest_update\` to sharpen a quest's title, description or objectives, and \`quest_objective_set\` to tick one.`,
    `- A folio, filed under this epic, if the review produces a design note worth keeping.`,
    ``,
    `Leave the open questions somewhere they will be read: a comment on the quest they concern, or a section in the epic's description.`,
  ].join("\n");
};
