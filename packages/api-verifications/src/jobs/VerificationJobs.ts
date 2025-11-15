import { $inject } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $repository } from "@alepha/orm";
import { $scheduler } from "@alepha/scheduler";
import { verifications } from "../entities/verifications.ts";
import { VerificationParameters } from "../parameters/VerificationParameters.ts";

export class VerificationJobs {
  protected readonly verificationRepository = $repository(verifications);
  protected readonly verificationParameters = $inject(VerificationParameters);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);

  public readonly cleanExpired = $scheduler({
    cron: "0 0 * * *", // Every day at midnight
    description: "Clean expired verifications",
    handler: async () => {
      const purgeDays = this.verificationParameters.get("purgeDays");
      if (purgeDays <= 0) {
        return; // Auto deletion is disabled
      }

      const dayMs = 24 * 60 * 60 * 1000;
      const purgeThreshold = Date.now() - purgeDays * dayMs;

      await this.verificationRepository.deleteMany({
        createdAt: {
          lt: this.dateTimeProvider.of(purgeThreshold).toISOString(),
        },
      });
    },
  });
}
