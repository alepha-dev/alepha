import { type Infer, z } from "alepha";

/**
 * Put one device on a channel, pin it to a bundle, or both.
 */
export const otaOverrideCreateSchema = z.object({
  appRef: z.uuid(),
  deviceId: z.text({ maxLength: 128 }),
  channel: z.text({ maxLength: 64 }).optional(),
  bundleId: z.uuid().optional(),
  note: z.text().optional(),
});

export type OtaOverrideCreate = Infer<typeof otaOverrideCreateSchema>;
