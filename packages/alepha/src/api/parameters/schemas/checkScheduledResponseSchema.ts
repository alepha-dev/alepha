import { t } from "alepha";

/**
 * Check scheduled response schema.
 */
export const checkScheduledResponseSchema = t.object({
  message: t.text(),
});
