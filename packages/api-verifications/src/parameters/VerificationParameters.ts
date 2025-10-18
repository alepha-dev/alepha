import { $config } from "@alepha/api-parameters";
import { t } from "@alepha/core";

export class VerificationParameters {
	public readonly settings = $config({
		name: "verifications.settings",
		description: "Configuration for the verification system.",
		schema: t.object({
			policy: t.object(
				{
					maxAttempts: t.int({
						description:
							"Maximum number of attempts before locking the verification.",
						minimum: 1,
						maximum: 10,
					}),
					codeLength: t.int({
						description: "Length of the verification code.",
						minimum: 4,
						maximum: 12,
					}),
					codeExpiration: t.int({
						description:
							"Time in seconds before the verification code expires.",
						minimum: 60, // 1 minute
						maximum: 3600, // 1 hour
					}),
					verificationCooldown: t.int({
						description:
							"Cooldown period in seconds after a request verification.",
						minimum: 0,
						maximum: 3600, // 1 hour
					}),
					limitPerDay: t.int({
						description:
							"Maximum number of verification requests per day for one entry.",
						minimum: 1,
						maximum: 100,
					}),
				},
				{
					description: "Settings specific to phone verifications.",
				},
			),
			purgeDays: t.int({
				description:
					"Number of days after which expired verifications are automatically deleted. Set to 0 to disable auto-deletion.",
				minimum: 0,
				maximum: 365,
			}),
		}),
		default: {
			policy: {
				maxAttempts: 5,
				codeLength: 6,
				codeExpiration: 300,
				verificationCooldown: 90,
				limitPerDay: 10,
			},
			purgeDays: 1,
		},
	});
}
