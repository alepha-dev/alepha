import { type Infer, z } from "alepha";

import { otaDeviceSchema } from "./otaDeviceSchema.ts";

/**
 * One lifecycle event the pinned updater reports (`set`, `download_fail`,
 * `checksum_fail`, `update_fail`, `app_moved_to_background`, ...).
 *
 * Untrusted telemetry: the server bounds and stores what it shows (the
 * versions devices were last seen on), and never decides anything from it.
 */
export const otaStatsEventSchema = otaDeviceSchema.extend({
  action: z.text({ maxLength: 64 }),
  metadata: z.record(z.text({ maxLength: 64 }), z.text()).optional(),
  timestamp: z.number().optional(),
});

export type OtaStatsEvent = Infer<typeof otaStatsEventSchema>;
