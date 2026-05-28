import { type Static, t } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Rollback parameter body schema.
 *
 * Creator fields are omitted; the controller captures the authenticated user
 * server-side.
 */
export const rollbackParameterBodySchema = t.extend(
  t.pick(parameters.schema, ["changeDescription"]),
  {
    targetVersion: t.integer({
      description: "Version number to rollback to",
    }),
  },
);

export type RollbackParameterBody = Static<typeof rollbackParameterBodySchema>;
