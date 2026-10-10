import { type Infer, z } from "alepha";

/**
 * A device as it last reported itself: telemetry, not a live presence.
 */
export const otaDeviceResourceSchema = z.object({
  id: z.uuid(),
  deviceId: z.text({ maxLength: 128 }),
  platform: z.enum(["ios", "android"]),
  versionCode: z.text({ maxLength: 64 }),
  versionBuild: z.text({ maxLength: 64 }).optional(),
  versionName: z.text({ maxLength: 128 }),
  channel: z.text({ maxLength: 64 }).optional(),
  pluginVersion: z.text({ maxLength: 64 }).optional(),
  isEmulator: z.boolean().optional(),
  failedVersions: z.array(z.text({ maxLength: 128 })),
  lastSeenAt: z.datetime(),
});

export type OtaDeviceResource = Infer<typeof otaDeviceResourceSchema>;
