import { $atom, type Infer, z } from "alepha";

/**
 * Configuration of the webhooks module.
 *
 * @example
 * ```ts
 * alepha.store.set(webhookOptions, {
 *   ...alepha.store.get(webhookOptions),
 *   retentionDays: 90,
 * });
 * ```
 */
export const webhookOptions = $atom({
  name: "alepha.api.webhooks",
  description: "Configuration of outbound webhooks.",
  schema: z.object({
    disableAfterDays: z
      .number()
      .min(1)
      .describe(
        "An endpoint whose unbroken run of failures began this many days ago is disabled, with reason `failing`, on its next failed attempt. Decided on a fresh failure, never by a cron: an endpoint with no traffic is never disabled.",
      ),
    retentionDays: z
      .number()
      .min(1)
      .describe(
        "Days a delivery is kept in the log, whatever its outcome, before the hourly purge deletes it.",
      ),
    stuckAfterHours: z
      .number()
      .min(1)
      .describe(
        "A delivery still `pending` and untouched this long, on an endpoint that is not paused, has lost its job: the hourly purge fails it with `no outcome recorded`. Above the 48 hours the retry curve can last.",
      ),
    purgeBatchSize: z
      .integer()
      .min(1)
      .describe("Rows the hourly purge reads and acts on per batch."),
    maxPurgeBatches: z
      .integer()
      .min(1)
      .describe("Batches per duty per purge run; the rest waits an hour."),
  }),
  default: {
    disableAfterDays: 5,
    retentionDays: 30,
    stuckAfterHours: 72,
    purgeBatchSize: 500,
    maxPurgeBatches: 20,
  },
  serverOnly: true,
});

export type WebhookOptions = Infer<typeof webhookOptions.schema>;
