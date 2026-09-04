import { $inject, Alepha, AlephaError, z } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $secure, currentTenantAtom, tenancyAtom } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";

import type { NotificationDeliveryEntity } from "../entities/notificationDeliveryEntity.ts";
import { NotificationJobs } from "../jobs/NotificationJobs.ts";
import { $notification } from "../primitives/$notification.ts";
import { notificationDetailResourceSchema } from "../schemas/notificationDetailResourceSchema.ts";
import {
  type NotificationPreviewResource,
  notificationPreviewResourceSchema,
} from "../schemas/notificationPreviewResourceSchema.ts";
import {
  type NotificationQuery,
  notificationQuerySchema,
} from "../schemas/notificationQuerySchema.ts";
import { notificationResourceSchema } from "../schemas/notificationResourceSchema.ts";
import { notificationSuppressionResourceSchema } from "../schemas/notificationSuppressionResourceSchema.ts";
import { notificationTemplateResourceSchema } from "../schemas/notificationTemplateResourceSchema.ts";
import { NotificationDeliveryService } from "../services/NotificationDeliveryService.ts";
import { NotificationSenderService } from "../services/NotificationSenderService.ts";
import { NotificationSuppressionService } from "../services/NotificationSuppressionService.ts";

export class AdminNotificationController {
  protected readonly url: string = "/notifications";
  protected readonly group: string = "admin:notifications";
  protected readonly alepha = $inject(Alepha);
  protected readonly notificationJobs = $inject(NotificationJobs);
  protected readonly executions = $repository(jobExecutionEntity);
  protected readonly suppressions = $inject(NotificationSuppressionService);
  protected readonly deliveries = $inject(NotificationDeliveryService);
  protected readonly sender = $inject(NotificationSenderService);
  protected readonly log = $logger();

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

  /**
   * True when `exec` belongs to the acting tenant.
   */
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
   * Page the delivery receipts, scoped to this tenant.
   *
   * ⚠️ **The receipts ARE the list**, not a merge with the outbox. Two
   * tables with two retention clocks and two sort keys cannot be paged as
   * one, and that is only acceptable because the sender writes a receipt on
   * every outcome including failures, so nothing an operator needs is
   * outbox-only.
   *
   * Accepted consequence: notifications pushed before this feature landed
   * have no receipt and do not appear. The empty state says so rather than
   * pretending otherwise.
   */
  protected async list(query: NotificationQuery) {
    const page = await this.deliveries.paginate(query, {
      organizationId: this.requireTenantScope(),
    });
    const alive = await this.liveExecutionIds(
      page.content.map((receipt) => receipt.executionId),
    );
    return {
      ...page,
      content: page.content.map((receipt) => ({
        ...this.toResource(receipt),
        outboxAvailable: alive.has(receipt.executionId),
      })),
    };
  }

  /**
   * Which of these execution ids still have a usable outbox row.
   *
   * ONE query for the whole page, never one per row. It also filters on
   * `jobName`: the outbox is shared with every other job, and a receipt
   * pointing at a foreign row carries no notification payload, so reporting
   * it as available would offer a resend that cannot work.
   *
   * The empty guard is not an optimisation - `inArray` throws on an empty
   * array, so without it an empty page is an error page.
   */
  protected async liveExecutionIds(ids: string[]): Promise<Set<string>> {
    // `job_executions.id` is a uuid column while the receipt stores its
    // `executionId` as text, so the receipt table can hold a value the
    // outbox could never match. Handing one to `inArray` does not return
    // nothing, it makes Postgres throw `invalid input syntax for type uuid`
    // and takes the whole list down with it.
    const candidates = ids.filter((id) => this.looksLikeExecutionId(id));
    // Not an optimisation: `inArray` throws on an empty array, so without
    // this an empty page is an error page.
    if (candidates.length === 0) {
      return new Set();
    }
    const rows = await this.executions.findMany({
      where: { id: { inArray: candidates }, jobName: { eq: this.jobName } },
      columns: ["id"] as any,
    });
    return new Set(rows.map((row) => String(row.id)));
  }

  protected looksLikeExecutionId(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  /**
   * The templates this app registers, for the list's filter dropdowns.
   *
   * ⚠️ Declared BEFORE {@link getNotification}, same reason as
   * {@link listSuppressions}: `GET /notifications/:id` has the same shape,
   * and the first route registered for a path wins.
   */
  public readonly listNotificationTemplates = $action({
    path: `${this.url}/templates`,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:read"] })],
    description: "List the notification templates this app registers",
    schema: {
      response: z.array(notificationTemplateResourceSchema),
    },
    handler: async () => this.templates() as any,
  });

  /**
   * Read the catalogue off the container rather than off the data.
   *
   * An in-memory list, so this costs no query, and it is correct for a
   * template nobody has sent yet. `SELECT DISTINCT template` over the
   * receipts would need an unindexed scan across the full retention window
   * and could still only offer what has already gone out.
   */
  protected templates() {
    return this.alepha.primitives($notification).map((template) => ({
      name: template.name,
      category: template.options.category,
      description: template.options.description,
      channels: [
        ...(template.options.email ? (["email"] as const) : []),
        ...(template.options.sms ? (["sms"] as const) : []),
      ],
      critical: template.options.critical === true,
      sensitive: template.options.sensitive === true,
    }));
  }

  /**
   * ⚠️ Declared BEFORE {@link getNotification}. `GET /notifications/:id` has
   * the same shape as `GET /notifications/suppressions`, and the first route
   * registered for a path wins, so moving this below would make the literal
   * segment unreachable behind the parameter.
   */
  public readonly listSuppressions = $action({
    path: `${this.url}/suppressions`,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:write"] })],
    description: "List suppressed contacts",
    schema: {
      query: z.object({
        sort: z.text().optional(),
        page: z.integer().min(0).optional(),
        size: z.integer().min(1).max(200).optional(),
      }),
      response: z.page(notificationSuppressionResourceSchema),
    },
    handler: async ({ query }) =>
      (await this.suppressions.paginate(query, {
        organizationId: this.requireTenantScope(),
      })) as any,
  });

  /**
   * Lift a suppression, re-enabling mail to that contact.
   *
   * Gated on `admin:notification:write` and deliberately NOT on the resend
   * permission (#1269's `admin:notification:send`): re-enabling mail to an
   * address that complained is the compliance-sensitive act, and resending
   * one message is an operator convenience. An operator trusted with the
   * second is not automatically trusted with the first.
   */
  public readonly liftSuppression = $action({
    method: "DELETE",
    path: `${this.url}/suppressions/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:write"] })],
    description: "Lift a suppression",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      const row = await this.suppressions.findById(params.id);
      const org = this.requireTenantScope();
      if (!row || (org && row.organizationId !== org)) {
        throw new NotFoundError(`Suppression not found: ${params.id}`);
      }
      await this.suppressions.lift(params.id);
      return { ok: true, id: params.id };
    },
  });

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
      const receipt = await this.requireReceipt(params.id);

      // The outbox row is fetched by executionId and is simply absent past
      // its own (shorter) retention window. The detail view has to render
      // either way.
      const exec = await this.findExecution(receipt.executionId);

      return this.toDetailResource(receipt, exec) as any;
    },
  });

  /**
   * The outbox row behind a receipt, or undefined.
   *
   * Undefined covers three different things, all of them normal: the row is
   * past its retention window, it belongs to another job (the outbox is
   * shared), or the receipt's `executionId` is not a uuid at all.
   *
   * That last case is not hypothetical. `job_executions.id` is a uuid column
   * while the receipt stores its `executionId` as text, so handing one
   * straight to `findById` makes Postgres throw `invalid input syntax for
   * type uuid` rather than returning nothing.
   */
  protected async findExecution(executionId: string) {
    if (!this.looksLikeExecutionId(executionId)) {
      return undefined;
    }
    const exec = await this.executions.findById(executionId);
    return exec && exec.jobName === this.jobName ? exec : undefined;
  }

  /**
   * Re-render one notification from its template.
   *
   * ⚠️ Declared after {@link getNotification} on purpose: `/:id/preview` has
   * a literal tail, so it cannot be shadowed by `/:id`.
   */
  public readonly previewNotification = $action({
    path: `${this.url}/:id/preview`,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:read"] })],
    description: "Re-render this notification from its template",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: notificationPreviewResourceSchema,
    },
    handler: async ({ params }) => this.preview(params.id) as any,
  });

  /**
   * The rendered message, or the reason there is none.
   *
   * Never throws for an expected absence. The three `available: false` cases
   * are states an operator hits routinely, and the UI has to draw each one
   * differently, so they are data rather than HTTP errors.
   */
  protected async preview(id: string): Promise<NotificationPreviewResource> {
    const receipt = await this.requireReceipt(id);
    const unavailable = (
      reason: NotificationPreviewResource["reason"],
    ): NotificationPreviewResource => ({
      available: false,
      reason,
      channel: receipt.channel,
      attachments: [],
      source: "live",
    });

    const exec = await this.findExecution(receipt.executionId);
    if (!exec?.payload) {
      return unavailable("outbox-purged");
    }

    const payload = exec.payload as Record<string, any>;
    if (payload.sensitive === true) {
      return unavailable("sensitive");
    }

    // Names, not bytes. The email channel resolves attachments through
    // storage and throws on a missing object, so previewing an old
    // notification whose attachment was purged would be a 500 instead of a
    // picture.
    const attachments: string[] = (payload.attachments ?? []).map(
      (attachment: { fileId: string }) => attachment.fileId,
    );
    const renderable = { ...payload, attachments: undefined };

    try {
      // The base fields only. A plugin channel carries whatever it needs in
      // its own channel-private `R` - a resolved webhook, a signed url - and
      // reading no further is what keeps that out of an admin response.
      const rendered = await this.sender.render(renderable as any);

      if (receipt.channel === "email") {
        return {
          available: true,
          channel: "email" as const,
          subject: rendered.subject ?? undefined,
          html: rendered.body ?? undefined,
          text: rendered.text ?? undefined,
          attachments,
          source: "live" as const,
        };
      }

      return {
        available: true,
        channel: receipt.channel,
        message: rendered.body ?? undefined,
        attachments,
        source: "live" as const,
      };
    } catch (error) {
      // The template was renamed or removed from the code since the send, or
      // its channel's plugin is no longer registered. All of those are real
      // states an operator can reach and not server faults, so they get a
      // reason rather than a 500.
      this.log.debug("Notification preview could not render", {
        id,
        template: receipt.template,
        error,
      });
      return unavailable("template-missing");
    }
  }

  /**
   * Push the same notification again, back through the gate.
   *
   * Gated on `admin:notification:send`, deliberately NOT on the suppression
   * permission: re-enabling mail to an address that complained and resending
   * one message are different acts.
   *
   * It goes through the gate rather than around it, so a resend to a
   * suppressed contact records a second `skipped` receipt instead of
   * quietly mailing someone who opted out.
   */
  public readonly resendNotification = $action({
    method: "POST",
    path: `${this.url}/:id/resend`,
    group: this.group,
    use: [$secure({ permissions: ["admin:notification:send"] })],
    description: "Send this notification again, through the suppression gate",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      const receipt = await this.requireReceipt(params.id);
      const exec = await this.findExecution(receipt.executionId);
      if (!exec?.payload) {
        throw new NotFoundError(
          `Cannot resend ${params.id}: the original payload is past the outbox retention window.`,
        );
      }

      await this.notificationJobs.sendNotification.push(exec.payload as any, {
        organizationId: receipt.organizationId ?? undefined,
      });

      return { ok: true, id: params.id };
    },
  });

  protected async requireReceipt(id: string) {
    const receipt = await this.deliveries.findById(id);
    const org = this.requireTenantScope();
    if (!receipt || (org && receipt.organizationId !== org)) {
      throw new NotFoundError(`Notification not found: ${id}`);
    }
    return receipt;
  }

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
      await this.requireReceipt(params.id);
      // Only the receipt. The outbox row is on its own, shorter clock and
      // the purge sweep owns it.
      await this.deliveries.deleteMany([params.id], {
        organizationId: this.requireTenantScope(),
      });
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
      // Confined to this org when multi-tenant, so one club cannot delete
      // another club's records.
      const deleted = await this.deliveries.deleteMany(body.ids, {
        organizationId: this.requireTenantScope(),
      });
      return { deleted };
    },
  });

  protected toResource(receipt: NotificationDeliveryEntity) {
    return {
      id: receipt.id,
      createdAt: receipt.createdAt,
      executionId: receipt.executionId,
      status: receipt.status,
      template: receipt.template,
      type: receipt.channel,
      contact: receipt.contact,
      category: receipt.category ?? undefined,
      critical: receipt.critical,
      skipReason: receipt.skipReason ?? undefined,
      subject: receipt.subject ?? undefined,
      provider: receipt.provider,
      messageId: receipt.messageId ?? undefined,
      smtpStatusCode: receipt.smtpStatusCode ?? undefined,
      lastEventAt: receipt.lastEventAt ?? undefined,
      error: receipt.error ?? undefined,
    };
  }

  protected toDetailResource(
    receipt: NotificationDeliveryEntity,
    exec?: Record<string, unknown>,
  ) {
    const payload = (exec?.payload ?? {}) as Record<string, unknown>;
    const sensitive = payload.sensitive === true;

    return {
      ...this.toResource(receipt),
      // `variables` hold the rendered personal data (reset links, codes,
      // addresses). A template flagged `sensitive` withholds them from the
      // admin view - otherwise the flag is decorative and the data is
      // readable by anyone with `admin:notification:read`. They also simply
      // vanish once the outbox row is purged, which is not an error.
      variables: sensitive ? undefined : payload.variables,
      // The receipt already withholds subject and body for a sensitive
      // template, so nothing needs re-filtering here.
      rendered: {
        ...(receipt.subject ? { subject: receipt.subject } : {}),
        ...(receipt.body ? { body: receipt.body } : {}),
      },
      logs: exec?.logs as never,
      outboxAvailable: Boolean(exec),
    };
  }
}
