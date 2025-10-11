import { type Static, t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";

export const verifications = $entity({
	name: "verifications",
	schema: t.object({
		id: pg.primaryKey(t.uuid()),
		version: pg.version(),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		type: t.enum(["PHONE_NUMBER", "EMAIL"]),
		target: t.string({
			description: "Can be a phone (E.164 format) or email address",
		}),
		code: t.string(),
		verifiedAt: t.optional(
			t.datetime({
				description: "When it was successfully verified",
			}),
		),
		attempts: pg.default(
			t.int({
				description: "Number of failed attempts (to prevent brute-force)",
			}),
			0,
		),
	}),
});

export type VerificationEntity = Static<typeof verifications.$schema>;
