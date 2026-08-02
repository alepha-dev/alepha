import { type Infer, z } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Rollback parameter body schema.
 *
 * Creator fields are omitted; the controller captures the authenticated user
 * server-side.
 */
export const rollbackParameterBodySchema = parameters.schema
  .pick({ changeDescription: true })
  .extend({
    targetVersion: z.integer().describe("Version number to rollback to"),
  });

export type RollbackParameterBody = Infer<typeof rollbackParameterBodySchema>;
