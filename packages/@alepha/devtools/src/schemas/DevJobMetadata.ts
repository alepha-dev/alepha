import { type Infer, z } from "alepha";

/**
 * A job declared with `$job`.
 *
 * This is the declarative half only — what the primitive says. Execution
 * counts, last-run and the execution rows themselves are runtime state and
 * come from `GET /__devtools/api/jobs`, which reads the durable outbox table.
 */
export const devJobMetadataSchema = z.object({
  name: z.text(),
  description: z.text().optional(),
  /**
   * `cron` when the job declares an expression, `queue` when it declares a
   * payload schema, `direct` otherwise. The *effective* mode can differ at
   * dispatch time (a queue job runs direct when no queue is loaded), which is
   * why the runtime endpoint reports its own `type`.
   */
  mode: z.enum(["cron", "queue", "direct"]),
  cron: z.text().optional(),
  priority: z.text().optional(),
  timeout: z.text().optional(),
  retries: z.integer().optional(),
  /**
   * Cron-mode only: whether the tick takes a distributed lock so a single
   * replica runs it.
   */
  lock: z.boolean().optional(),
  /**
   * Which executions are persisted — `error` (default for queue), `all`, or
   * `none`.
   */
  record: z.text().optional(),
  /**
   * Payload schema for queue-mode jobs, as JSON Schema.
   */
  schema: z.any().optional(),
});

export type DevJobMetadata = Infer<typeof devJobMetadataSchema>;
