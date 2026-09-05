import { $inject, z } from "alepha";
import {
  notificationDetailResourceSchema,
  notificationPreviewResourceSchema,
  notificationQuerySchema,
  notificationResourceSchema,
  notificationTemplateResourceSchema,
} from "alepha/api/notifications";
import { $action } from "alepha/server";

import { ShowcaseNotifications } from "./ShowcaseNotifications.ts";

/**
 * Stands in for `AdminNotificationController`.
 *
 * ⚠️ Property names ARE action names and must match the real controller.
 *
 * The two detail actions are worth having rather than skipping, because both
 * carry behaviour that only shows up when the data says so:
 *
 * - a `sensitive` template stores no rendered body, so the detail sheet has to
 *   draw an absence rather than a value;
 * - `previewNotification` answers `available: false` with a REASON as a normal
 *   200, because "the outbox row aged out" and "this template is never
 *   rendered for an operator" are states the UI draws, not errors.
 *
 * Resending and deleting accept the call and change nothing: one shared page.
 */
export class ShowcaseNotificationsController {
  protected readonly notifications = $inject(ShowcaseNotifications);

  public readonly findNotifications = $action({
    path: "/admin/notifications",
    schema: {
      query: notificationQuerySchema,
      response: z.page(notificationResourceSchema),
    },
    handler: ({ query }) => this.notifications.paginate(query as any),
  });

  public readonly listNotificationTemplates = $action({
    path: "/admin/notifications/templates",
    schema: {
      response: z.array(notificationTemplateResourceSchema),
    },
    handler: () => this.notifications.templates(),
  });

  public readonly getNotification = $action({
    path: "/admin/notifications/:id",
    schema: {
      params: z.object({ id: z.text() }),
      response: notificationDetailResourceSchema,
    },
    handler: ({ params }) => {
      const row =
        this.notifications.rows().find((r) => r.id === params.id) ??
        this.notifications.rows()[0];
      const sensitive = row.template === "password-reset";
      return {
        ...row,
        // Absent for a sensitive template, and absent once the outbox row is
        // purged. Both are the real behaviour rather than a fixture gap.
        variables:
          sensitive || !row.outboxAvailable
            ? undefined
            : { firstName: "Ada", plan: "Team" },
        rendered:
          sensitive || !row.outboxAvailable
            ? undefined
            : { subject: row.subject, body: "<p>Hello Ada,</p>" },
        logs: undefined,
      } as any;
    },
  });

  public readonly previewNotification = $action({
    path: "/admin/notifications/:id/preview",
    schema: {
      params: z.object({ id: z.text() }),
      response: notificationPreviewResourceSchema,
    },
    handler: ({ params }) => {
      const row =
        this.notifications.rows().find((r) => r.id === params.id) ??
        this.notifications.rows()[0];

      if (row.template === "password-reset") {
        return {
          available: false,
          reason: "sensitive",
          channel: "email",
        } as any;
      }
      if (!row.outboxAvailable) {
        return {
          available: false,
          reason: "outbox-purged",
          channel: "email",
        } as any;
      }
      return {
        available: true,
        channel: "email",
        subject: row.subject,
        body: "<p>Hello Ada,</p><p>Here is your weekly digest.</p>",
      } as any;
    },
  });

  public readonly resendNotification = $action({
    method: "POST",
    path: "/admin/notifications/:id/resend",
    schema: {
      params: z.object({ id: z.text() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
  });

  public readonly deleteNotification = $action({
    method: "DELETE",
    path: "/admin/notifications/:id",
    schema: {
      params: z.object({ id: z.text() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
  });

  public readonly deleteNotifications = $action({
    method: "DELETE",
    path: "/admin/notifications",
    schema: {
      body: z.object({ ids: z.array(z.text()) }),
      response: z.object({ deleted: z.integer() }),
    },
    handler: ({ body }) => ({ deleted: body.ids.length }),
  });
}
