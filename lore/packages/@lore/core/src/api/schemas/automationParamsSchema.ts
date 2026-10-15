import { z } from "alepha";

export const automationParamsSchema = z
  .object({ projectId: z.integer(), id: z.uuid() })
  .strict();
