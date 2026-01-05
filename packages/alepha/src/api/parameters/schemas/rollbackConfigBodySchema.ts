import { type Static, t } from "alepha";

/**
 * Rollback config body schema.
 */
export const rollbackConfigBodySchema = t.object({
  targetVersion: t.integer({
    description: "Version number to rollback to",
  }),
  changeDescription: t.optional(t.text()),
  creatorId: t.optional(t.uuid()),
  creatorName: t.optional(t.text()),
});

export type RollbackConfigBody = Static<typeof rollbackConfigBodySchema>;
