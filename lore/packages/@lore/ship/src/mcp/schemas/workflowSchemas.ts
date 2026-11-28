import { projectParamsSchema } from "@lore/core/schemas";
import { z } from "alepha";

// -----------------------------------------------------------------------------
// workflow_list

export const workflowListParamsSchema = projectParamsSchema;

// -----------------------------------------------------------------------------
// workflow_run

export const workflowRunParamsSchema = projectParamsSchema.extend({
  workflow_id: z
    .integer()
    .describe("The workflow's id, as `workflow_list` returns it."),
  ref: z
    .string()
    .min(1)
    .max(255)
    .describe("The branch or tag to run it on (`main`, `v1.2.0`)."),
  inputs: z
    .record(z.string().max(100), z.string().max(1_000))
    .optional()
    .describe(
      'The workflow\'s inputs by name, each a string (`"true"` for a boolean). Checked against what the workflow declares: an unknown name, a missing required one or a choice outside its options is refused.',
    ),
});

export const workflowRunResultSchema = z.object({
  id: z
    .string()
    .describe(
      "The dispatch's id. GitHub names no run at once: the run shows in `workflow_list` once it started, marked with who asked.",
    ),
});

// -----------------------------------------------------------------------------
// workflow_rerun

export const workflowRerunParamsSchema = projectParamsSchema.extend({
  run_id: z.integer().describe("The run's id, as `workflow_list` returns it."),
  failed_only: z
    .boolean()
    .optional()
    .describe("Re-run only the failed jobs. Default: the whole run."),
});

// -----------------------------------------------------------------------------
// workflow_cancel

export const workflowCancelParamsSchema = projectParamsSchema.extend({
  run_id: z.integer().describe("The run's id, as `workflow_list` returns it."),
});
