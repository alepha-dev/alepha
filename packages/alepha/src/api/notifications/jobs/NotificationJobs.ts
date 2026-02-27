import { $inject } from "alepha";
import { $job, jobExecutionEntity } from "alepha/api/jobs";
import { $repository } from "alepha/orm";
import { notificationPayloadSchema } from "../schemas/notificationPayloadSchema.ts";
import { NotificationSenderService } from "../services/NotificationSenderService.ts";

export class NotificationJobs {
  protected readonly notificationSenderService = $inject(
    NotificationSenderService,
  );
  protected readonly executions = $repository(jobExecutionEntity);

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
        const rendered = await this.notificationSenderService.send(
          item.payload,
        );
        if (rendered) {
          await this.executions.updateById(item.id, {
            result: rendered as Record<string, unknown>,
          });
        }
      }
    },
  });
}
