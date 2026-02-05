import { type Static, t } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Rollback parameter body schema.
 * Uses t.pick for creator fields, adds targetVersion.
 */
export const rollbackParameterBodySchema = t.extend(
  t.pick(parameters.schema, ["changeDescription", "creatorId", "creatorName"]),
  {
    targetVersion: t.integer({
      description: "Version number to rollback to",
    }),
  },
);

export type RollbackParameterBody = Static<typeof rollbackParameterBodySchema>;
