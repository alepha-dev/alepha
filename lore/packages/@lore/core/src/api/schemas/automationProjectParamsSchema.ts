import { z } from "alepha";

export const automationProjectParamsSchema = z
  .object({ projectId: z.integer() })
  .strict();
