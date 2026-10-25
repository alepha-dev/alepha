import { type Infer, z } from "alepha";

export const automationPageQuerySchema = z
  .object({
    offset: z.integer().min(0).max(100_000).default(0),
    limit: z.integer().min(1).max(50).default(20),
  })
  .strict();
export type AutomationPageQuery = Infer<typeof automationPageQuerySchema>;
