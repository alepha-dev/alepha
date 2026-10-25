import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { otaApps } from "./otaApps.ts";

/**
 * What a device last said about itself. Telemetry, never authentication:
 * every field comes from an unauthenticated request, and nothing is decided
 * on it except which bundle this device should no longer be offered.
 */
export const otaDevices = $entity({
  name: "ota_devices",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    appRef: db.ref(z.uuid(), () => otaApps.cols.id, { onDelete: "cascade" }),

    deviceId: z.text({ maxLength: 128 }),
    platform: z.enum(["ios", "android"]),
    versionCode: z.text({ maxLength: 64 }),
    versionBuild: z.text({ maxLength: 64 }).optional(),

    /**
     * The web layer it runs: a bundle version, or the store version on the
     * built-in layer.
     */
    versionName: z.text({ maxLength: 128 }),

    /**
     * The channel the server resolved for it at its last check.
     */
    channel: z.text({ maxLength: 64 }).optional(),

    pluginVersion: z.text({ maxLength: 64 }).optional(),
    isEmulator: z.boolean().optional(),

    /**
     * Bundle versions this device rolled back from, newest last, at most
     * 20: never offered to it again.
     */
    failedVersions: db.default(z.array(z.text({ maxLength: 128 })), []),

    lastSeenAt: z.datetime(),
  }),
  indexes: [{ columns: ["appRef", "deviceId"], unique: true }],
});

export type OtaDeviceEntity = Infer<typeof otaDevices.schema>;
