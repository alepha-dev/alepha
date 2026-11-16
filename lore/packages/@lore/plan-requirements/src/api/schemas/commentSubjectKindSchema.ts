import { type Infer, z } from "alepha";

/**
 * What a `requirements_comments` row hangs off (#E153): a persona or a use
 * case. Stored as text, so a subject added later is a code-only change.
 */
export const commentSubjectKindSchema = z.enum(["persona", "usecase"]);

export type CommentSubjectKind = Infer<typeof commentSubjectKindSchema>;
