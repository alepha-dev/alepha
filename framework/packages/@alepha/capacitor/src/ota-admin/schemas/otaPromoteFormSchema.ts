import { z } from "alepha";

/**
 * Serving a bundle from a channel.
 */
export const otaPromoteFormSchema = z.object({
  channelId: z.text(),
  rollout: z.integer().min(0).max(100),
});
