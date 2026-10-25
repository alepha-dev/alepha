import { z } from "alepha";

/**
 * One device's assignment.
 */
export const otaOverrideFormSchema = z.object({
  deviceId: z.text({ maxLength: 128 }),
  channel: z.text({ maxLength: 64 }).optional(),
  bundleId: z.text().optional(),
  note: z.text().optional(),
});
