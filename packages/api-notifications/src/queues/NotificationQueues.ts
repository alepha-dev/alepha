import { $inject, t } from "@alepha/core";
import { $queue } from "@alepha/queue";
import { NotificationSenderService } from "../services/NotificationSenderService.ts";

export class NotificationQueues {
  protected readonly notificationSenderService = $inject(
    NotificationSenderService,
  );

  public readonly processNotification = $queue({
    description: "Queue for processing notifications",
    schema: t.object({
      notificationId: t.string({ format: "uuid" }),
    }),
    handler: async (message) => {
      await this.notificationSenderService.send(message.payload.notificationId);
    },
  });
}
