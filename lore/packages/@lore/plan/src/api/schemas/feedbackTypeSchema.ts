import { type Infer, z } from "alepha";

/**
 * What a feedback report is (#Q4037): the request form's required first
 * field, and `feedback_submit`'s `type`. Not a column: it is folded into the
 * report's tags by `FeedbackTypeTags`, `idea` as `feature` so the embed's
 * `?type=feature` and the form agree.
 */
export const feedbackTypeSchema = z.enum(["bug", "idea", "question", "other"]);

export type FeedbackType = Infer<typeof feedbackTypeSchema>;
