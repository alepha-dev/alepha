import { type Infer } from "alepha";

import { requirementsComments } from "../entities/requirementsComments.ts";

/**
 * One comment on a persona or a use case (#E153).
 */
export const requirementsCommentResourceSchema = requirementsComments.schema;

export type RequirementsCommentResource = Infer<
  typeof requirementsCommentResourceSchema
>;
