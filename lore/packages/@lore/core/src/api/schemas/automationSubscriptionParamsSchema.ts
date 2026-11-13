import { z } from "alepha";

export const automationSubscriptionParamsSchema = z
  .object({ projectId: z.integer(), key: z.string().min(1).max(128) })
  .strict();
