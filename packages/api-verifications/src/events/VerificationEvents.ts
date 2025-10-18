import { t } from "@alepha/core";
import { $topic } from "@alepha/topic";
import { verificationEntitySchema } from "../entities/verifications.ts";

export class VerificationEvents {
	public readonly onVerified = $topic({
		description: "Triggered when a verification is completed.",
		provider: "memory",
		schema: {
			payload: t.object({
				verification: verificationEntitySchema,
			}),
		},
	});
}
