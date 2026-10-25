import { type Infer, z } from "alepha";

import { automationPageQuerySchema } from "./automationPageQuerySchema.ts";

export const automationListQuerySchema = automationPageQuerySchema
  .extend({
    search: z.string().max(255).optional(),
    state: z.enum(["disabled", "active", "paused", "broken"]).optional(),
    authorUserId: z.uuid().optional(),
  })
  .strict();
export type AutomationListQuery = Infer<typeof automationListQuerySchema>;
