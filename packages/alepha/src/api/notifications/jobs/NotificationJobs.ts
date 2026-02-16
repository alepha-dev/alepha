import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { notificationPayloadSchema } from "../schemas/notificationPayloadSchema.ts";
import { NotificationSenderService } from "../services/NotificationSenderService.ts";

export class NotificationJobs {
  protected readonly notificationSenderService = $inject(
    NotificationSenderService,
  );

  public readonly sendNotification = $job({
    schema: notificationPayloadSchema,
    retry: {
      retries: 3,
      backoff: {
        initial: [5, "seconds"],
        factor: 4,
        max: [10, "minutes"],
        jitter: true,
      },
    },
    timeout: [30, "seconds"],
    concurrency: 5,
    handler: async ({ items }) => {
      for (const item of items) {
        await this.notificationSenderService.send(item.payload);
      }
    },
  });
}
