import { type Infer, z } from "alepha";

import { otaDeviceSchema } from "./otaDeviceSchema.ts";

/**
 * One lifecycle event the pinned updater reports (`set`, `download_fail`,
 * `checksum_fail`, `update_fail`, `app_moved_to_background`, ...).
 *
 * Untrusted telemetry: the server bounds and stores what it shows (the
 * versions devices were last seen on). The one decision it feeds is that
 * device's own: an `update_fail` adds the version to the device's failed
 * versions, which it is never offered again.
 */
export const otaStatsEventSchema = otaDeviceSchema.extend({
  action: z.text({ maxLength: 64 }),
  metadata: z.record(z.text({ maxLength: 64 }), z.text()).optional(),
  timestamp: z.number().optional(),
});

export type OtaStatsEvent = Infer<typeof otaStatsEventSchema>;
