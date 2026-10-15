import { monitorExpectSchema } from "../../../../../api/schemas/monitorExpectSchema.ts";
import { monitorSettingsSchema } from "../../../../../api/schemas/monitorSettingsSchema.ts";
export const monitorFormSchema = monitorSettingsSchema
  .omit({ expect: true })
  .extend({
    expectedStatus: monitorExpectSchema.shape.status,
    keyword: monitorExpectSchema.shape.keyword,
    latencyBudgetMs: monitorExpectSchema.shape.latencyBudgetMs,
    certWarningDays: monitorExpectSchema.shape.certWarningDays,
  });
