import { z } from "alepha";

export const automationSubscriptionParamsSchema = z
  .object({ projectId: z.integer() })
  .strict();
