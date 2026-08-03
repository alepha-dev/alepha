import { $atom, type Infer, z } from "alepha";

export const jobConfig = $atom({
  name: "alepha.jobs",
  description: "Configuration for the $job primitive.",
  schema: z.object({
    sweepCron: z.text({
      description:
        "Cron expression for the sweep tick. Must be minute-granular at minimum (cron resolution). On Cloudflare Workers this expression is emitted into wrangler.jsonc by the build.",
    }),
    trimCron: z.text({
      description:
        "Cron expression for the ring-buffer trim tick (per-job keepLastSuccess/keepLastError enforcement). Decoupled from `sweepCron` because trim is bounded by job execution rate, not retry latency — running it every sweep is wasted work for most apps.",
    }),
    staleThreshold: z
      .integer()
      .describe("Pending age (ms) before the sweep re-dispatches it."),
    runTimeout: z
      .integer()
      .describe(
        "Running age (ms) before assumed crash (fallback when no per-job timeout).",
      ),
    keepLastSuccess: z
      .integer()
      .describe(
        "Max successful rows to keep per job. Set 0 to disable and delete on success.",
      ),
    keepLastError: z.integer().describe("Max error rows to keep per job."),
    logMaxEntries: z
      .integer()
      .describe("Max log entries captured per execution."),
    drainTimeout: z
      .integer()
      .describe("Max time (ms) to wait for in-flight jobs during shutdown."),
    directMaxConcurrency: z
      .integer()
      .min(1)
      .describe(
        "Max executions the direct (no-broker) dispatcher runs at once. A pushMany of thousands would otherwise start every handler in parallel and exhaust the database pool. Excess dispatches wait in memory; the outbox row stays the durability guarantee, so anything still queued when the process dies is re-dispatched by the next sweep.",
      ),
  }),
  default: {
    sweepCron: "*/15 * * * *",
    trimCron: "0 * * * *",
    staleThreshold: 300_000,
    runTimeout: 1_800_000,
    keepLastSuccess: 10,
    keepLastError: 10,
    logMaxEntries: 100,
    drainTimeout: 30_000,
    directMaxConcurrency: 10,
  },
  serverOnly: true,
});

export type JobConfig = Infer<typeof jobConfig.schema>;

declare module "alepha" {
  interface State {
    [jobConfig.key]: JobConfig;
  }
}
