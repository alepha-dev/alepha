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

    expiresAt: z
      .datetime()
      .describe(
        "Per-entry expiry, overriding the type's `codeExpiration` setting. " +
          "Set when a link must live exactly as long as the thing it unlocks " +
          "(an invitation, say) rather than as long as a code a human is " +
          "about to type. Absent means the setting decides, which is the " +
          "case for every code and for a plain reset link.",
      )
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

export type VerificationEntity = Infer<typeof verifications.schema>;
