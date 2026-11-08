import { type Infer, z } from "alepha";

/**
 * Where a review `question` stands (#E121). A `decision` and a `change` have
 * no state: theirs is absent on the row.
 *
 * `open` until the owner answers it (`answered`, with the answer text) or
 * sets it aside (`waived`). Both are final for the open-question count, which
 * is what the Review tab, the epic list and the ready confirm show.
 */
export const epicReviewItemStateSchema = z.enum(["open", "answered", "waived"]);

export type EpicReviewItemState = Infer<typeof epicReviewItemStateSchema>;
