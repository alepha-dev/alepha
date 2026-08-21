import { $inject, Alepha, AlephaError, z } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import { $repository } from "alepha/orm";
import { $secure, currentTenantAtom, tenancyAtom } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";

import { NotificationJobs } from "../jobs/NotificationJobs.ts";
import { notificationDetailResourceSchema } from "../schemas/notificationDetailResourceSchema.ts";
import {
  type NotificationQuery,
  notificationQuerySchema,
} from "../schemas/notificationQuerySchema.ts";
import { notificationResourceSchema } from "../schemas/notificationResourceSchema.ts";

export class AdminNotificationController {
  protected readonly url: string = "/notifications";
  protected readonly group: string = "admin:notifications";
  protected readonly alepha = $inject(Alepha);
  protected readonly notificationJobs = $inject(NotificationJobs);
  protected readonly executions = $repository(jobExecutionEntity);

  protected get jobName(): string {
    return this.notificationJobs.sendNotification.name;
  }

  /**
   * The tenant this request is acting in, when multi-tenant. The notification
   * outbox (`job_executions`) is shared across tenants in a pooled worker, so
   * every read/delete here is scoped to this org to prevent cross-tenant access.
   * Undefined in single-tenant apps → no extra filter (all rows are this app's).
   */
  protected get organizationId(): string | undefined {
    return this.alepha.store.get(currentTenantAtom)?.id;
  }

  /**
   * The tenant every read and write here must be confined to, or `undefined`
   * in a single-tenant app where there is nothing to confine.
   *
   * `job_executions` is deliberately NOT an org-scoped entity — the outbox is
   * shared, and `organizationId` rides in the push context. So the repository's
   * own fail-closed guard never fires on this table and these three call sites
   * are the entire gate. All three used to be written as `if (org) { filter }`,
   * which means an unresolved tenant removed the filter instead of refusing:
   * on a pooled worker, one admin listing — or deleting — every tenant's
   * notifications.
   *
   * @throws when the app declares itself multi-tenant and no tenant resolved.
   *   There is no row such a caller is entitled to, so refusing beats returning
   *   everything.
   */
  protected requireTenantScope(): string | undefined {
    const org = this.organizationId;
    if (org) {
      return org;
    }
    if (this.alepha.store.get(tenancyAtom).mode === "multi") {
      throw new AlephaError(
        "Refusing to serve the notification outbox with no resolved tenant (multi-tenant mode). " +
          "Resolve the tenant into `currentTenantAtom` before reaching this endpoint.",
      );
    }
    return undefined;
  }

  /** True when `exec` belongs to the acting tenant. */
  protected sameTenant(exec: { organizationId?: string | null }): boolean {
    const org = this.requireTenantScope();
    return !org || exec.organizationId === org;
  }

  public readonly findNotifications = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:read"] })],
    schema: {
      query: notificationQuerySchema,
      response: z.page(notificationResourceSchema),
    },
    handler: async ({ query }) => this.list(query) as any,
  });

  /**
   * Page the notification outbox, scoped to this job and tenant.
   */
  protected async list(query: NotificationQuery) {
    query.sort ??= "-createdAt";
    const where = this.executions.createQueryWhere();
    where.jobName = { eq: this.jobName };
    const org = this.requireTenantScope();
    if (org) {
      where.organizationId = { eq: org };
    }
    if (query.status) {
      where.status = { eq: query.status };
    }
    const page = await this.executions.paginate(
      query,
      { where },
      { count: true },
    );
    return {
      ...page,
      content: page.content.map((exec) => this.toResource(exec)),
    };
  }

  public readonly getNotification = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:read"] })],
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: notificationDetailResourceSchema,
    },
    handler: async ({ params }) => {
      const exec = await this.executions.findById(params.id);
      if (!exec || exec.jobName !== this.jobName || !this.sameTenant(exec)) {
        throw new NotFoundError(`Notification not found: ${params.id}`);
      }
      return this.toDetailResource(exec) as any;
    },
  });

  public readonly deleteNotification = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:delete"] })],
    description: "Delete a notification record",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      const exec = await this.executions.findById(params.id);
      if (!exec || exec.jobName !== this.jobName || !this.sameTenant(exec)) {
        throw new NotFoundError(`Notification not found: ${params.id}`);
      }
      await this.executions.deleteById(params.id);
      return { ok: true, id: params.id };
    },
  });

  public readonly deleteNotifications = $action({
    method: "POST",
    path: `${this.url}/delete`,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:delete"] })],
    description: "Delete many notification records in one call",
    schema: {
      body: z.object({
        ids: z.array(z.uuid()).min(1).max(1000),
      }),
      response: z.object({
        deleted: z.array(z.uuid()),
      }),
    },
    handler: async ({ body }) => {
      // Constrain to this job's executions so an admin can't delete arbitrary
      // job rows through this endpoint — and, when multi-tenant, to this org so
      // one club can't delete another club's notification records.
      const org = this.requireTenantScope();
      const deleted = await this.executions.deleteMany({
        id: { inArray: body.ids },
        jobName: { eq: this.jobName },
        ...(org ? { organizationId: { eq: org } } : {}),
      });
      return { deleted: deleted.map(String) };
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
      // `variables` hold the rendered personal data (reset links, codes,
      // addresses). A template flagged `sensitive` withholds them from the
      // admin view — otherwise the flag is decorative and the data is
      // readable by anyone with `admin:notification:read`.
      variables: payload.sensitive ? undefined : payload.variables,
      logs: exec.logs,
    };
  }
}
