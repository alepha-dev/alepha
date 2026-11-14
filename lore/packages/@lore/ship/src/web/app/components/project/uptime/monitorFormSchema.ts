import { z } from "alepha";

import { monitorExpectSchema } from "../../../../../api/schemas/monitorExpectSchema.ts";
import { monitorNotificationSettingsSchema } from "../../../../../api/schemas/monitorNotificationSettingsSchema.ts";
import { monitorSettingsSchema } from "../../../../../api/schemas/monitorSettingsSchema.ts";
export const monitorFormSchema = monitorSettingsSchema
  .omit({ expect: true, notifications: true })
  .extend({
    emailAlerts: monitorNotificationSettingsSchema.shape.email,
    // Optional, so the form draws no required marker on it (#Q2679).
    recipients: z.string().max(4000).optional(),
    expectedStatus: monitorExpectSchema.shape.status,
    keyword: monitorExpectSchema.shape.keyword,
    latencyBudgetMs: monitorExpectSchema.shape.latencyBudgetMs,
    certWarningDays: monitorExpectSchema.shape.certWarningDays,
  });
