import { $inject, t } from "alepha";
import { JobService } from "alepha/api/jobs";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { NotificationJobs } from "../jobs/NotificationJobs.ts";
import { notificationDetailResourceSchema } from "../schemas/notificationDetailResourceSchema.ts";
import { notificationQuerySchema } from "../schemas/notificationQuerySchema.ts";
import { notificationResourceSchema } from "../schemas/notificationResourceSchema.ts";

export class AdminNotificationController {
  protected readonly url: string = "/notifications";
  protected readonly group: string = "admin:notifications";
  protected readonly jobService = $inject(JobService);
  protected readonly notificationJobs = $inject(NotificationJobs);

  protected get jobName(): string {
    return this.notificationJobs.sendNotification.name;
  }

  public readonly findNotifications = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:read"] })],
    schema: {
      query: notificationQuerySchema,
      response: t.page(notificationResourceSchema),
    },
    handler: async ({ query }) => {
      const result = await this.jobService.findExecutions({
        ...query,
        job: this.jobName,
      });
      return {
        ...result,
        content: result.content.map((exec) => this.toResource(exec)),
      } as any;
    },
  });

  public readonly getNotification = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:read"] })],
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: notificationDetailResourceSchema,
    },
    handler: async ({ params }) => {
      const detail = await this.jobService.getExecution(params.id);
      return this.toDetailResource(detail) as any;
    },
  });

  protected toResource(exec: Record<string, unknown>) {
    const payload = (exec.payload ?? {}) as Record<string, unknown>;
    return {
      id: exec.id,
      createdAt: exec.createdAt,
      status: exec.status,
      template: payload.template,
      type: payload.type,
      contact: payload.contact,
      category: payload.category,
      critical: payload.critical,
      sensitive: payload.sensitive,
      startedAt: exec.startedAt,
      completedAt: exec.completedAt,
      error: exec.error,
    };
  }

  protected toDetailResource(exec: Record<string, unknown>) {
    const payload = (exec.payload ?? {}) as Record<string, unknown>;
    return {
      ...this.toResource(exec),
      variables: payload.variables,
      rendered: exec.result,
      logs: exec.logs,
    };
  }
}
