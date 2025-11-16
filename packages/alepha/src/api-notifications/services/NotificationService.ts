import { $batch } from "alepha/batch";
import { $env, $inject, Alepha, type Static, t } from "alepha";
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

const envSchema = t.object({
  NOTIFICATION_IMMEDIATE: t.optional(
    t.boolean({
      description:
        "If true, notifications will be sent immediately instead of being batched and queued. True by default in serverless and test environments.",
    }),
  ),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

export class NotificationService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly notificationRepository = $repository(notifications);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly notificationQueues = $inject(NotificationQueues);
  protected readonly notificationSenderService = $inject(
    NotificationSenderService,
  );

  public readonly notificationBatch = $batch({
    maxSize: 100,
    maxDuration: [15, "seconds"],
    schema: notificationCreateSchema,
    handler: async (notifications: NotificationCreate[]) => {
      this.log.debug("Notification batch processing", {
        size: notifications.length,
      });

      const entities =
        await this.notificationRepository.createMany(notifications);

      await this.notificationQueues.processNotification.push(
        ...entities.map((it) => ({ notificationId: it.id })),
      );
    },
  });

  public async findNotificationById(id: string) {
    return this.notificationRepository.findOne({ where: { id } });
  }

  /**
   * Create a new notification.
   */
  public async createNotification(
    entry: NotificationCreate,
    now = false,
  ): Promise<void> {
    this.log.trace("Create notification", {
      entry,
    });

    if (
      now ||
      this.env.NOTIFICATION_IMMEDIATE === true ||
      (this.env.NOTIFICATION_IMMEDIATE == null &&
        (this.alepha.isServerless() || this.alepha.isTest()))
    ) {
      const notification = await this.notificationRepository.create(entry);
      await this.notificationSenderService.send(notification);
      return;
    }

    this.notificationBatch.push(entry).catch((e) => {
      this.log.error("Failed to push notification to batch", e);
    });
  }
}
