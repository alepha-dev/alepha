import { $env, $inject, Alepha, type Static, t } from "alepha";
import { $batch } from "alepha/batch";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { notifications } from "../entities/notifications.ts";
import { NotificationQueues } from "../queues/NotificationQueues.ts";
import {
  type NotificationCreate,
  notificationCreateSchema,
} from "../schemas/notificationCreateSchema.ts";
import { NotificationSenderService } from "./NotificationSenderService.ts";

export const notificationServiceEnvSchema = t.object({
  NOTIFICATION_QUEUE: t.optional(
    t.boolean({
      description:
        "If true, notifications will be queued instead of sent immediately",
    }),
  ),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof notificationServiceEnvSchema>> {}
}

export class NotificationService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly env = $env(notificationServiceEnvSchema);
  protected readonly notificationRepository = $repository(notifications);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly notificationSenderService = $inject(
    NotificationSenderService,
  );

  public readonly notificationBatch = $batch({
    maxSize: 100,
    maxDuration: [15, "seconds"],
    schema: notificationCreateSchema,
    handler: async (notifications: NotificationCreate[]) => {
      this.log.debug("Processing notification batch", {
        size: notifications.length,
        templates: [...new Set(notifications.map((n) => n.template))],
      });

      const entities =
        await this.notificationRepository.createMany(notifications);

      await this.alepha
        .inject(NotificationQueues)
        .processNotification.push(
          ...entities.map((it) => ({ notificationId: it.id })),
        );

      this.log.info("Notification batch queued", {
        count: entities.length,
        ids: entities.map((it) => it.id),
      });
    },
  });

  public async findNotificationById(id: string) {
    this.log.trace("Finding notification by ID", { id });
    return this.notificationRepository.findOne({ where: { id } });
  }

  /**
   * Create a new notification.
   */
  public async createNotification(entry: NotificationCreate): Promise<void> {
    this.log.trace("Creating notification", {
      template: entry.template,
      type: entry.type,
      contact: entry.contact,
    });

    if (
      this.env.NOTIFICATION_QUEUE !== true ||
      this.alepha.isServerless() ||
      this.alepha.isTest()
    ) {
      this.log.debug("Sending notification immediately", {
        template: entry.template,
        type: entry.type,
        contact: entry.contact,
      });
      const notification = await this.notificationRepository.create(entry);
      await this.notificationSenderService.send(notification);
      return;
    }

    this.log.debug("Queuing notification to batch", {
      template: entry.template,
      type: entry.type,
      contact: entry.contact,
    });

    this.notificationBatch.push(entry).catch((e) => {
      this.log.error("Failed to push notification to batch", {
        template: entry.template,
        type: entry.type,
        contact: entry.contact,
        error: e,
      });
    });
  }
}
