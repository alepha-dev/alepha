import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const requestVerificationCodeResponseSchema = t.object({
	codeExpiration: t.int({
		description: "Time in seconds before your verification code expires.",
	}),
	verificationCooldown: t.int({
		description: "Cooldown period in seconds.",
	}),
	maxVerificationAttempts: t.int({
		description: "Maximum number of verification attempts allowed.",
	}),
});

export type RequestVerificationResponse = Static<
	typeof requestVerificationCodeResponseSchema
>;
