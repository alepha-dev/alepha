import { $atom, type Static, t } from "alepha";

export const jobConfig = $atom({
  name: "alepha.jobs",
  description: "Configuration for the $job v2 primitive.",
  schema: t.object({
    batchWindow: t.integer({
      description: "Max time (ms) to buffer pushes before flushing.",
    }),
    batchMaxSize: t.integer({ description: "Max items per flush." }),
    recovery: t.object({
      interval: t.integer({ description: "Sweep interval (ms)." }),
      staleThreshold: t.integer({
        description: "Pending age (ms) before re-dispatch.",
      }),
      runTimeout: t.integer({
        description:
          "Running age (ms) before assumed crash. Used as fallback when no per-job timeout is set.",
      }),
    }),
    delayed: t.object({
      interval: t.integer({ description: "Sweep interval (ms)." }),
    }),
    logRetentionDays: t.integer({
      description: "Days to keep completed/dead executions.",
    }),
    logMaxEntries: t.integer({
      description: "Max log entries captured per execution.",
    }),
    shutdownGracePeriod: t.integer({
      description: "Max time (ms) to wait for running handlers on shutdown.",
    }),
    prefix: t.optional(
      t.text({
        description: "Prefix for lock keys (multi-tenant).",
      }),
    ),
  }),
  default: {
    batchWindow: 10,
    batchMaxSize: 1000,
    recovery: {
      interval: 300_000,
      staleThreshold: 300_000,
      runTimeout: 1_800_000,
    },
    delayed: {
      interval: 300_000,
    },
    logRetentionDays: 30,
    logMaxEntries: 100,
    shutdownGracePeriod: 30_000,
  },
});

export type JobConfig = Static<typeof jobConfig.schema>;

declare module "alepha" {
  interface State {
    [jobConfig.key]: JobConfig;
  }
}
