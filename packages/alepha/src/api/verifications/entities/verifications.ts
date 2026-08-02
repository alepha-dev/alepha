import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";
import { verificationTypeEnumSchema } from "../schemas/verificationTypeEnumSchema.ts";

export const verifications = $entity({
  name: "verification",
  schema: z.object({
    id: db.primaryKey(z.bigint()),

    createdAt: db.createdAt(),

    updatedAt: db.updatedAt(),

    version: db.version(),

    type: verificationTypeEnumSchema,

    target: z.text({
      description: "Can be a phone (E.164 format) or email address",
    }),

    purpose: db.default(
      z.text({
        description:
          "Logical purpose bucket (e.g. 'default', 'password-reset'). Scopes the cooldown and daily-limit checks so unrelated flows that share the same (type, target) — most notably email verification and password reset — don't collide.",
      }),
      "default",
    ),

    code: z.text({
      description: "Hashed verification token (n-digit code or UUID)",
    }),

    verifiedAt: z
      .datetime()
      .describe("When it was successfully verified")
      .optional(),

    attempts: db.default(
      z
        .integer()
        .describe("Number of failed attempts (to prevent brute-force)"),
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
export type VerificationEntity = Infer<typeof verifications.schema>;
