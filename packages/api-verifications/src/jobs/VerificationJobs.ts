import { $inject } from "@alepha/core";
import { $repository } from "@alepha/postgres";
import { $scheduler } from "@alepha/scheduler";
import { verifications } from "../entities/verifications.ts";
import { VerificationParameters } from "../parameters/VerificationParameters.ts";

export class VerificationJobs {
	protected readonly verificationRepository = $repository(verifications);
	protected readonly verificationParameters = $inject(VerificationParameters);

	public readonly cleanExpired = $scheduler({
		cron: "0 0 * * *", // Every day at midnight
		description: "Clean expired verifications",
		handler: async () => {
			const purgeDays = this.verificationParameters.settings.get("purgeDays");
			if (purgeDays <= 0) {
				return; // Auto deletion is disabled
			}

			const dayMs = 24 * 60 * 60 * 1000;
			const purgeThreshold = Date.now() - purgeDays * dayMs;

			await this.verificationRepository.deleteMany({
				createdAt: {
					lt: new Date(purgeThreshold).toISOString(),
				},
			});
		},
	});
}
