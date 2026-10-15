import { z } from "alepha";

export const monitorExpectSchema = z.object({
  status: z.integer().min(100).max(599).optional(),
  keyword: z.string().max(1000).optional(),
  latencyBudgetMs: z.integer().min(1).optional(),
  certWarningDays: z.integer().min(0).max(365).optional(),
});
