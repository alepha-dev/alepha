import { type Infer, z } from "alepha";

/**
 * The machine itself, in absolute units, wire format v1.
 *
 * ⚠️ Every field is optional, and that is load-bearing rather than lazy. Bay
 * reads each of these independently, degrading one unreadable `/proc` file to
 * an absent field; a required field here would turn a container without
 * `/proc/loadavg` into a machine that reports nothing at all.
 *
 * Absent is not zero, on either side. The console says "not reported" for a
 * field it did not get, and "0 B of 0 B" for one it invented.
 *
 * Percentages are deliberately not here: the `stats` frame carries those for
 * the estate list badge and the series, and this frame carries the bytes the
 * badge cannot produce.
 */
export const estateInventoryHostSchema = z.object({
  cores: z.integer().min(0).max(4096).optional(),
  memTotalBytes: z.integer().min(0).optional(),
  memUsedBytes: z.integer().min(0).optional(),
  diskTotalBytes: z.integer().min(0).optional(),
  diskUsedBytes: z.integer().min(0).optional(),
  /** The one-minute load average, unbounded above: it is a queue length, not a share. */
  load1: z.number().min(0).optional(),
  uptimeSeconds: z.integer().min(0).optional(),
  bayVersion: z.string().max(100).optional(),
});

export type EstateInventoryHost = Infer<typeof estateInventoryHostSchema>;
