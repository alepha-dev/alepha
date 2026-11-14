import type { Infer } from "alepha";

import { stackRevisions } from "../entities/stackRevisions.ts";

/**
 * One revision as a page shows it: the compose text and the model, never the
 * blob's storage id, which only a machine's pull needs.
 */
export const stackRevisionResourceSchema = stackRevisions.schema.omit({
  fileId: true,
});

export type StackRevisionResource = Infer<typeof stackRevisionResourceSchema>;
