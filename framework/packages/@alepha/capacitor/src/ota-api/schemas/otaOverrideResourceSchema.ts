import { type Infer, z } from "alepha";

/**
 * An operator's assignment of one device.
 */
export const otaOverrideResourceSchema = z.object({
  id: z.uuid(),
  deviceId: z.text({ maxLength: 128 }),
  channel: z.text({ maxLength: 64 }).optional(),
  bundleId: z.uuid().optional(),
  note: z.text().optional(),
  createdAt: z.datetime(),
});

export type OtaOverrideResource = Infer<typeof otaOverrideResourceSchema>;
