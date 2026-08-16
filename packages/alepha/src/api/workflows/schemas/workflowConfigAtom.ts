import { $atom, type Infer, z } from "alepha";

export const workflowConfig = $atom({
  name: "alepha.workflows",
  description: "Configuration for the workflow engine.",
  schema: z.object({
    defaultStepTimeout: z
      .integer()
      .describe(
        "Default step timeout (ms). Used when no per-step timeout is set.",
      ),
    retentionDays: z
      .integer()
      .describe("Days to keep completed/failed workflow executions."),
    recovery: z.object({
      staleThreshold: z
        .integer()
        .describe("Running step age (ms) before assumed crashed."),
    }),
    timeoutCron: z
      .text()
      .describe(
        "Cron expression for the deadline sweep. Bounds how late a workflow's `timeout` is enforced: a workflow past its deadline keeps running, and its steps keep their abort controllers, until the next tick. Set it well under your shortest workflow timeout if deadlines must bite promptly — the default trades that promptness for one Worker invocation per quarter-hour instead of sixty per hour.",
      ),
    recoveryCron: z
      .text()
      .describe(
        "Cron expression for the crashed-step recovery sweep. Also the fallback delivery path for steps whose dispatch was lost with the process, so it bounds how long a stranded workflow stays stuck. Only acts on steps older than `recovery.staleThreshold`, so a tick well under that threshold buys nothing.",
      ),
    purgeCron: z
      .text()
      .describe(
        "Cron expression for the retention purge of terminal executions. Bounded by `retentionDays`, not by the tick, so this only decides when the deletion happens — off-peak by default.",
      ),
    drainTimeout: z
      .integer()
      .describe("Max time (ms) to wait for in-flight steps during shutdown."),
    logMaxEntries: z
      .integer()
      .describe("Max log entries captured per step execution."),
  }),
  default: {
    defaultStepTimeout: 300_000,
    retentionDays: 30,
    recovery: {
      staleThreshold: 1_800_000,
    },
    timeoutCron: "*/15 * * * *",
    recoveryCron: "*/15 * * * *",
    purgeCron: "0 3 * * *",
    drainTimeout: 30_000,
    logMaxEntries: 100,
  },
  serverOnly: true,
});

export type WorkflowConfig = Infer<typeof workflowConfig.schema>;

declare module "alepha" {
  interface State {
    [workflowConfig.key]: WorkflowConfig;
  }
}
