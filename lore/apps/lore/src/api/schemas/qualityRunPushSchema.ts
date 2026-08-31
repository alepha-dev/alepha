import { type Infer, z } from "alepha";

/**
 * What `alepha lore quality push` sends: totals, and nothing else.
 *
 * ~200 bytes. It used to also carry `reports`, the raw `json-summary` and
 * vitest report inline, which made the request ~3.1 MB against a 100 KB body
 * limit - so every push this endpoint ever received was refused with a 413 and
 * the table stayed empty. The reports are gone rather than moved to a bigger
 * transport: no endpoint served them back, so nothing was losing a reader. See
 * the entity doc.
 *
 * ⚠️ **No `day` here, on purpose.** The row's day bucket is stamped
 * server-side. A caller that named its own bucket could overwrite any day it
 * liked, and a CI runner's clock would decide which one its push landed in.
 */
export const qualityRunPushSchema = z.object({
  commitSha: z.string().min(7).max(40),
  branch: z.string().min(1).max(200),
  coverage: z.object({
    lines: z.number().min(0).max(100),
    statements: z.number().min(0).max(100),
    functions: z.number().min(0).max(100),
    branches: z.number().min(0).max(100),
  }),
  tests: z.object({
    total: z.integer().min(0),
    passed: z.integer().min(0),
    failed: z.integer().min(0),
    /**
     * The SUM of `numPendingTests` and `numTodoTests`. The CLI adds them;
     * there is one column.
     */
    skipped: z.integer().min(0),
  }),
  /**
   * Derived by the caller as the maximum per-file `endTime` minus the run's
   * `startTime`: the vitest JSON report has no top-level duration.
   */
  durationMs: z.integer().min(0),
});

export type QualityRunPush = Infer<typeof qualityRunPushSchema>;
