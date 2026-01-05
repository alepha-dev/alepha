import { type Static, t } from "alepha";

/**
 * Activate config body schema.
 */
export const activateConfigBodySchema = t.object({
  version: t.integer({ description: "Version number to activate" }),
  creatorId: t.optional(t.uuid()),
  creatorName: t.optional(t.text()),
});

export type ActivateConfigBody = Static<typeof activateConfigBodySchema>;
