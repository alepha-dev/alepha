import { z } from "alepha";

import { monitorHeartbeats } from "../entities/monitorHeartbeats.ts";
/**
 * Raw SQL returns SQLite booleans as integers; repository selects decode them.
 */
export const monitorHeartbeatStoredSchema = monitorHeartbeats.schema.extend({
  ok: z
    .union([monitorHeartbeats.schema.shape.ok, z.number().int().min(0).max(1)])
    .transform((value) => Boolean(value)),
});
