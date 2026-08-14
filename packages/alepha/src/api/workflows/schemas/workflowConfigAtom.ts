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
