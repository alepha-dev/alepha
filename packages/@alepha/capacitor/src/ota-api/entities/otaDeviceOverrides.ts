import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { otaApps } from "./otaApps.ts";

/**
 * An operator's assignment of one device: to a channel (a private QA
 * channel), or pinned to one bundle. Made through the admin with
 * `ota:manage`, never by the device: a `device_id` in a request authorizes
 * nothing.
 *
 * A killed bundle is never served, pin or not.
 */
export const otaDeviceOverrides = $entity({
  name: "ota_device_overrides",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    appRef: db.ref(z.uuid(), () => otaApps.cols.id, { onDelete: "cascade" }),

    deviceId: z.text({ maxLength: 128 }),

    /**
     * The channel this device follows, by name.
     */
    channel: z.text({ maxLength: 64 }).optional(),

    /**
     * The bundle this device runs, whatever its channel serves.
     */
    bundleId: z.uuid().optional(),

    note: z.text().optional(),
  }),
  indexes: [{ columns: ["appRef", "deviceId"], unique: true }],
});

export type OtaDeviceOverrideEntity = Infer<typeof otaDeviceOverrides.schema>;
