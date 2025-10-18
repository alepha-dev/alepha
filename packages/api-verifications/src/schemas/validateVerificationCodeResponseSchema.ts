import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const validateVerificationCodeResponseSchema = t.object({
	ok: t.boolean({
		description: "Indicates whether the verification was successful.",
	}),
	alreadyVerified: t.optional(
		t.boolean({
			description: "Indicates whether the target was already verified.",
		}),
	),
});

export type ValidateVerificationCodeResponse = Static<
	typeof validateVerificationCodeResponseSchema
>;
