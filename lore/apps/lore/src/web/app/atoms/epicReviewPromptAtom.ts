import { $atom, z } from "alepha";

/**
 * The epic-review prompt currently open for editing, or nothing.
 *
 * An atom rather than local state because the dialog is mounted ONCE, in
 * `Layout`, while two surfaces open it: the Epics row menu and the epic's own
 * page. `useEpicReviewPrompt` writes here and both call sites stay the single
 * line they were, which is what stops the two from diverging (feedback #2097
 * refines #2087, and one hook serving both was the point of the first).
 *
 * Same shape as `spotlightOpenAtom`: an app-wide surface driven by state
 * rather than by whichever page happens to render it. No React Context, per
 * the repo's own rule.
 *
 * `text` is carried rather than rebuilt by the dialog, so the dialog needs to
 * know nothing about how a prompt is composed and there is exactly one place
 * that decides what goes into one.
 */
export const epicReviewPromptAtom = $atom({
  name: "lor.epic.review_prompt",
  schema: z
    .object({
      /** The `#N` the toast names once the text is copied. */
      reference: z.string(),
      text: z.string(),
    })
    .optional(),
});
