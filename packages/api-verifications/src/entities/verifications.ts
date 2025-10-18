import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";
import { verificationTypeEnumSchema } from "../schemas/verificationTypeEnumSchema.ts";

export const verifications = $entity({
	name: "verification",
	schema: t.object({
		id: pg.primaryKey(t.bigint()),

		createdAt: pg.createdAt(),

		updatedAt: pg.updatedAt(),

		version: pg.version(),

		type: verificationTypeEnumSchema,

		target: t.text({
			description: "Can be a phone (E.164 format) or email address",
		}),

		code: t.text({
			description: "Hashed verification token (6-digit code for phone, UUID for email)",
		}),

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
	indexes: [
		"createdAt",
		{
			columns: ["target", "code"],
		},
	],
});

export const verificationEntitySchema = verifications.$schema;
export const verificationEntityInsertSchema = verifications.$insertSchema;
export type VerificationEntity = Static<typeof verifications.$schema>;
