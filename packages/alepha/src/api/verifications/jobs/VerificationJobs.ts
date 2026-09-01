import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { verifications } from "../entities/verifications.ts";
import { VerificationParameters } from "../parameters/VerificationParameters.ts";

export class VerificationJobs {
  protected readonly verificationRepository = $repository(verifications);
  protected readonly verificationParameters = $inject(VerificationParameters);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);

  public readonly cleanExpired = $job({
    name: "api:verifications:cleanExpired",
    cron: "0 * * * *", // Hourly at minute 0
    description: "Clean expired verifications",
    handler: async () => {
      const purgeDays = this.verificationParameters.get("purgeDays");
      if (purgeDays <= 0) {
        return; // Auto deletion is disabled
      }

      const dayMs = 24 * 60 * 60 * 1000;
      const purgeThreshold =
        this.dateTimeProvider.nowMillis() - purgeDays * dayMs;

      // A row carrying its own `expiresAt` is kept until that date passes,
      // whatever its age. `purgeDays` defaults to 1, so without this clause a
      // seven-day invitation link would be deleted on its second day and stop
      // resolving with no trace of why.
      await this.verificationRepository.deleteMany({
        and: [
          {
            createdAt: {
              lt: this.dateTimeProvider.of(purgeThreshold).toISOString(),
            },
          },
          {
            or: [
              { expiresAt: { isNull: true } },
              { expiresAt: { lt: this.dateTimeProvider.nowISOString() } },
            ],
          },
        ],
      });
    },
  });
}
