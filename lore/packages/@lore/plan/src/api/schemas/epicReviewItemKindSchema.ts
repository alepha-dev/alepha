import { type Infer, z } from "alepha";

/**
 * What one item of an epic review is (#E121, folio #F1460).
 *
 * - `question`: the owner's to answer, with suggestions and the one the
 *   reviewer would take. It has a state (`epicReviewItemStateSchema`).
 * - `decision`: a call the reviewer took alone, with its reason. The owner
 *   can overturn it, which files a new decision naming the one it replaces.
 * - `change`: what the review edited (the epic description, a quest created
 *   or sharpened), optionally pointing at the quest or epic it touched.
 *
 * Stored with `mode: "text"`, so a fourth kind is a code-only change. Never
 * ordered by: a text enum sorts alphabetically, not by meaning.
 */
export const epicReviewItemKindSchema = z.enum([
  "question",
  "decision",
  "change",
]);

export type EpicReviewItemKind = Infer<typeof epicReviewItemKindSchema>;
