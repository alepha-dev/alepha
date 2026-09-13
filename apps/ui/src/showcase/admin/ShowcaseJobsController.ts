import { $inject, z } from "alepha";
import {
  jobExecutionQuerySchema,
  jobExecutionResourceSchema,
  jobExecutionRowSchema,
  jobRegistrationSchema,
  triggerJobSchema,
} from "alepha/api/jobs";
import { $action, NotFoundError } from "alepha/server";

import { ShowcaseJobs } from "./ShowcaseJobs.ts";

/**
 * Stands in for `AdminJobController` so `<AdminJobs />` and its executions
 * panel render.
 *
 * ⚠️ Property names ARE action names; they must match the real controller.
 *
 * `triggerJob`, `retryExecution`, `cancelExecution` and both deletes accept
 * and change nothing: the showcase is one shared page, so a visitor must not
 * be able to mutate what the next visitor sees. They answer in the right
 * shape, which is what the component needs to toast and refetch.
 */
export class ShowcaseJobsController {
  protected readonly jobs = $inject(ShowcaseJobs);

  public readonly listJobs = $action({
    path: "/admin/jobs",
    schema: {
      response: z.array(jobRegistrationSchema),
    },
    handler: () => this.jobs.registrations(),
  });

  public readonly listExecutions = $action({
    path: "/admin/jobs/:name/executions",
    schema: {
      params: z.object({ name: z.text() }),
      query: jobExecutionQuerySchema,
      response: z.page(jobExecutionRowSchema),
    },
    handler: ({ params, query }) => this.jobs.page(params.name, query) as any,
  });

  public readonly getExecution = $action({
    path: "/admin/jobs/executions/:id",
    schema: {
      params: z.object({ id: z.text() }),
      response: jobExecutionResourceSchema,
    },
    handler: ({ params }) => {
      const execution = this.jobs.execution(params.id);
      if (!execution) {
        throw new NotFoundError(`Execution not found: ${params.id}`);
      }
      return execution as any;
    },
  });

  public readonly triggerJob = $action({
    method: "POST",
    path: "/admin/jobs/:name/trigger",
    schema: {
      params: z.object({ name: z.text() }),
      body: triggerJobSchema,
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
  });

  public readonly retryExecution = $action({
    method: "POST",
    path: "/admin/jobs/executions/:id/retry",
    schema: {
      params: z.object({ id: z.text() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
  });

  public readonly cancelExecution = $action({
    method: "POST",
    path: "/admin/jobs/executions/:id/cancel",
    schema: {
      params: z.object({ id: z.text() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
  });

  public readonly deleteExecution = $action({
    method: "DELETE",
    path: "/admin/jobs/executions/:id",
    schema: {
      params: z.object({ id: z.text() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
  });

  public readonly deleteExecutions = $action({
    method: "POST",
    path: "/admin/jobs/executions/delete",
    schema: {
      body: z.object({ ids: z.array(z.text()).min(1).max(100) }),
      response: z.object({ deleted: z.integer(), skipped: z.integer() }),
    },
    handler: ({ body }) => {
      const terminal = body.ids.filter(
        (id) => this.jobs.execution(id)?.can.delete === true,
      );
      return {
        deleted: terminal.length,
        skipped: body.ids.length - terminal.length,
      };
    },
  });
}
