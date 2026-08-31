import { type Infer, z } from "alepha";

/**
 * What `alepha lore quality push` sends.
 *
 * Totals and reports in ONE request. The alternative was an upload followed by
 * a register call, the way folio attachments work, and it was rejected: that
 * shape exists because a browser holds the bytes and the server does not, which
 * is not the case here. A CI job posting twice can also half-succeed, leaving
 * an uploaded report no row will ever point at.
 *
 * `reports` is optional so a caller may push totals alone. Nothing does today,
 * and the field being optional is what keeps the read path's dangling-file
 * handling from being a special case.
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
  /**
   * The raw `json-summary` and vitest report, kept opaque. `z.any()` is not
   * valid for a request body on its own, so this is the record form.
   */
  reports: z.record(z.text(), z.any()).optional(),
});

export type QualityRunPush = Infer<typeof qualityRunPushSchema>;
