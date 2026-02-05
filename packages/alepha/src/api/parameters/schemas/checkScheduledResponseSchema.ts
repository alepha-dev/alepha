import { type Static, t } from "alepha";

/**
 * Check scheduled response schema.
 */
export const checkScheduledResponseSchema = t.object({
  message: t.text(),
});

export type CheckScheduledResponse = Static<
  typeof checkScheduledResponseSchema
>;
