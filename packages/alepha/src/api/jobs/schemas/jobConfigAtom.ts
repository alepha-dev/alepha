import { $atom, type Static, t } from "alepha";

export const jobConfig = $atom({
  name: "alepha.jobs",
  description: "Configuration for the $job primitive.",
  schema: t.object({
    sweepCron: t.text({
      description:
        "Cron expression for the sweep tick. Must be minute-granular at minimum (cron resolution). On Cloudflare Workers this expression is emitted into wrangler.jsonc by the build.",
    }),
    staleThreshold: t.integer({
      description: "Pending age (ms) before the sweep re-dispatches it.",
    }),
    runTimeout: t.integer({
      description:
        "Running age (ms) before assumed crash (fallback when no per-job timeout).",
    }),
    keepLastSuccess: t.integer({
      description:
        "Max successful rows to keep per job. Set 0 to disable and delete on success.",
    }),
    keepLastError: t.integer({
      description: "Max error rows to keep per job.",
    }),
    logMaxEntries: t.integer({
      description: "Max log entries captured per execution.",
    }),
    drainTimeout: t.integer({
      description: "Max time (ms) to wait for in-flight jobs during shutdown.",
    }),
  }),
  default: {
    sweepCron: "*/5 * * * *",
    staleThreshold: 300_000,
    runTimeout: 1_800_000,
    keepLastSuccess: 10,
    keepLastError: 10,
    logMaxEntries: 100,
    drainTimeout: 30_000,
  },
});

export type JobConfig = Static<typeof jobConfig.schema>;

declare module "alepha" {
  interface State {
    [jobConfig.key]: JobConfig;
  }
}
