import { z } from "alepha";

import { automationDiagnosticResourceSchema } from "./automationDiagnosticResourceSchema.ts";

export const automationDiagnosticPageSchema = z.object({
  items: z.array(automationDiagnosticResourceSchema),
  hasMore: z.boolean(),
});
