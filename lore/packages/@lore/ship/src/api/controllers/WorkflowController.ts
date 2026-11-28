import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { workflowDispatchBodySchema } from "../schemas/workflowDispatchBodySchema.ts";
import { workflowsResourceSchema } from "../schemas/workflowsResourceSchema.ts";
import { WorkflowService } from "../services/WorkflowService.ts";

/**
 * The project's GitHub workflows (#Q4366, epic #E177): the ones its
 * connected repository can start, the recent runs, and the three writes.
 *
 * Reads take `app:read`; a dispatch, a re-run and a cancel take
 * `deploy:workflow` with Ship on, and are refused under a job key by the
 * service, whatever the key's rank.
 */
export class WorkflowController {
  protected readonly workflows = $inject(WorkflowService);

  protected writeGate = () =>
    $ownsProject({
      param: "projectId",
      requires: "deploy:workflow",
      capability: "ship",
    });

  getWorkflows = $action({
    use: [$ownsProject({ param: "projectId", requires: "app:read" })],
    method: "GET",
    path: "/projects/:projectId/workflows",
    description:
      "The connected repository's workflows that declare workflow_dispatch, with their inputs, and its recent runs.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: workflowsResourceSchema,
    },
    handler: async ({ params }) => await this.workflows.list(params.projectId),
  });

  dispatchWorkflow = $action({
    use: [this.writeGate()],
    method: "POST",
    path: "/projects/:projectId/workflows/dispatches",
    description:
      "Starts a workflow on a branch or tag with its inputs. Never under a job key.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: workflowDispatchBodySchema,
      response: z.object({ id: z.uuid() }),
    },
    handler: async ({ params, body, user }) =>
      await this.workflows.dispatch(params.projectId, body, user!),
  });

  rerunWorkflowRun = $action({
    use: [this.writeGate()],
    method: "POST",
    path: "/projects/:projectId/workflows/runs/:runId/rerun",
    description: "Re-runs a run, or only its failed jobs.",
    schema: {
      params: z.object({ projectId: z.integer(), runId: z.integer() }),
      body: z.object({ failedOnly: z.boolean().optional() }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.workflows.rerun(
        params.projectId,
        params.runId,
        body.failedOnly ?? false,
        user!,
      );
      return { ok: true };
    },
  });

  cancelWorkflowRun = $action({
    use: [this.writeGate()],
    method: "POST",
    path: "/projects/:projectId/workflows/runs/:runId/cancel",
    description: "Cancels a run.",
    schema: {
      params: z.object({ projectId: z.integer(), runId: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.workflows.cancel(params.projectId, params.runId, user!);
      return { ok: true };
    },
  });
}
