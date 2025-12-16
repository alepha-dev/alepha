import type { Static } from "alepha";
import { t } from "alepha";
import { $entity, pg } from "alepha/orm";
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
      description: "Hashed verification token (n-digit code or UUID)",
    }),

    verifiedAt: t.optional(
      t.datetime({
        description: "When it was successfully verified",
      }),
    ),

    attempts: pg.default(
      t.integer({
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

export const verificationEntitySchema = verifications.schema;
export const verificationEntityInsertSchema = verifications.insertSchema;
export type VerificationEntity = Static<typeof verifications.schema>;
