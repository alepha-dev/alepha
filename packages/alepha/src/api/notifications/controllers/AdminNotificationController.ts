import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import { notifications } from "../entities/notifications.ts";
import { notificationQuerySchema } from "../schemas/notificationQuerySchema.ts";
import { NotificationService } from "../services/NotificationService.ts";

export class AdminNotificationController {
  protected readonly url = "/notifications";
  protected readonly group = "admin:notifications";
  protected readonly notificationService = $inject(NotificationService);

  /**
   * Find notifications with pagination and filtering.
   */
  public readonly findNotifications = $action({
    path: this.url,
    group: this.group,
    description: "Find notifications with pagination and filtering",
    schema: {
      query: notificationQuerySchema,
      response: t.page(notifications.schema),
    },
    handler: ({ query }) => this.notificationService.findNotifications(query),
  });
}
