import { type Infer, z } from "alepha";

import { inspectorRunEntrySchema } from "./InspectorRunEntry.ts";

/**
 * A run as `discover()` reports it: the entry the process wrote, plus where
 * the reader found it.
 */
export const inspectorRunSchema = inspectorRunEntrySchema.extend({
  /**
   * The entry file's absolute path.
   */
  file: z.text({ size: "long" }),
  /**
   * The socket's absolute path, resolved against the directory the entry was
   * found in rather than taken from the writer.
   */
  socketPath: z.text({ size: "long" }),
  /**
   * `live` when its socket accepts a connection. A `dead` run is still listed
   * while its log file exists, so the logs of a crash stay readable once the
   * process is gone.
   */
  status: z.enum(["live", "dead"]),
});

export type InspectorRun = Infer<typeof inspectorRunSchema>;
