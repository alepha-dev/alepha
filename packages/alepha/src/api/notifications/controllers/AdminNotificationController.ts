import { $inject, t } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";
import { NotificationJobs } from "../jobs/NotificationJobs.ts";
import { notificationDetailResourceSchema } from "../schemas/notificationDetailResourceSchema.ts";
import { notificationQuerySchema } from "../schemas/notificationQuerySchema.ts";
import { notificationResourceSchema } from "../schemas/notificationResourceSchema.ts";

export class AdminNotificationController {
  protected readonly url: string = "/notifications";
  protected readonly group: string = "admin:notifications";
  protected readonly notificationJobs = $inject(NotificationJobs);
  protected readonly executions = $repository(jobExecutionEntity);

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
      query.sort ??= "-createdAt";
      const where = this.executions.createQueryWhere();
      where.jobName = { eq: this.jobName };
      const page = await this.executions.paginate(
        query,
        { where },
        { count: true },
      );
      return {
        ...page,
        content: page.content.map((exec) => this.toResource(exec)),
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
      const exec = await this.executions.findById(params.id);
      if (!exec || exec.jobName !== this.jobName) {
        throw new NotFoundError(`Notification not found: ${params.id}`);
      }
      return this.toDetailResource(exec) as any;
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
      logs: exec.logs,
    };
  }
}
