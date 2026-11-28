import { ProjectTools } from "@lore/core/mcp";
import { $inject, z } from "alepha";
import { $tool } from "alepha/mcp";

import { WorkflowController } from "../../api/controllers/WorkflowController.ts";
import { workflowsResourceSchema } from "../../api/schemas/workflowsResourceSchema.ts";
import {
  workflowCancelParamsSchema,
  workflowListParamsSchema,
  workflowRerunParamsSchema,
  workflowRunParamsSchema,
  workflowRunResultSchema,
} from "../schemas/workflowSchemas.ts";

/**
 * The project's GitHub workflows for a member (#Q4366), on the actions the
 * Workflows section calls, so the gates are the same (`app:read` to list,
 * `deploy:workflow` to start, re-run or cancel). A job key is refused every
 * write: an agent job never starts a workflow through Lore.
 */
export class WorkflowTools {
  protected readonly workflows = $inject(WorkflowController);
  protected readonly projects = $inject(ProjectTools);

  workflow_list = $tool({
    title: "List GitHub workflows",
    description:
      "The connected repository's workflows that declare workflow_dispatch, each with its id and inputs (name, type, required, default, options), and the recent runs with their status, conclusion and who started them from Lore. `connected` is false for a project not connected to GitHub.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: workflowListParamsSchema.strict(),
      result: workflowsResourceSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.workflows.getWorkflows({ params: { projectId } });
    },
  });

  workflow_run = $tool({
    title: "Start a GitHub workflow",
    description:
      "Start a workflow on a branch or tag with its inputs (needs deploy:workflow). Written to the project's activity with who asked and the inputs. Refused under an agent job's key.",
    annotations: { readOnlyHint: false, idempotentHint: false },
    schema: {
      params: workflowRunParamsSchema.strict(),
      result: workflowRunResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.workflows.dispatchWorkflow({
        params: { projectId },
        body: {
          workflowId: params.workflow_id,
          ref: params.ref,
          ...(params.inputs ? { inputs: params.inputs } : {}),
        },
      });
    },
  });

  workflow_rerun = $tool({
    title: "Re-run a GitHub workflow run",
    description:
      "Re-run a run, or only its failed jobs with failed_only (needs deploy:workflow). Written to the project's activity. Refused under an agent job's key.",
    annotations: { readOnlyHint: false, idempotentHint: false },
    schema: {
      params: workflowRerunParamsSchema.strict(),
      result: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.workflows.rerunWorkflowRun({
        params: { projectId, runId: params.run_id },
        body: { failedOnly: params.failed_only ?? false },
      });
    },
  });

  workflow_cancel = $tool({
    title: "Cancel a GitHub workflow run",
    description:
      "Cancel a run (needs deploy:workflow). Written to the project's activity. Refused under an agent job's key.",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: workflowCancelParamsSchema.strict(),
      result: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.workflows.cancelWorkflowRun({
        params: { projectId, runId: params.run_id },
      });
    },
  });
}
