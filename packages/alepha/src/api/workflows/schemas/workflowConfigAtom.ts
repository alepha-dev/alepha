import { $atom, type Static, t } from "alepha";

export const workflowConfig = $atom({
  name: "alepha.workflows",
  description: "Configuration for the workflow engine.",
  schema: t.object({
    defaultStepTimeout: t.integer({
      description:
        "Default step timeout (ms). Used when no per-step timeout is set.",
    }),
    retentionDays: t.integer({
      description: "Days to keep completed/failed workflow executions.",
    }),
    recovery: t.object({
      staleThreshold: t.integer({
        description: "Running step age (ms) before assumed crashed.",
      }),
    }),
    maxConcurrentWorkflows: t.integer({
      description: "Max concurrent running instances per workflow name.",
    }),
    maxStepsPerWorkflow: t.integer({
      description: "Safety limit on step count.",
    }),
    drainTimeout: t.integer({
      description: "Max time (ms) to wait for in-flight steps during shutdown.",
    }),
    logMaxEntries: t.integer({
      description: "Max log entries captured per step execution.",
    }),
  }),
  default: {
    defaultStepTimeout: 300_000,
    retentionDays: 30,
    recovery: {
      staleThreshold: 1_800_000,
    },
    maxConcurrentWorkflows: 50,
    maxStepsPerWorkflow: 100,
    drainTimeout: 30_000,
    logMaxEntries: 100,
  },
});

export type WorkflowConfig = Static<typeof workflowConfig.schema>;

declare module "alepha" {
  interface State {
    [workflowConfig.key]: WorkflowConfig;
  }
}
