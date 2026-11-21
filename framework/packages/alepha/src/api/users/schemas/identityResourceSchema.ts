import { type Infer, z } from "alepha";

import { identities } from "../entities/identities.ts";

/**
 * An identity as the admin API answers it.
 *
 * `password` is the credential hash and never leaves. `providerData` is an
 * allow-list, not the column: the column holds whatever its provider keeps
 * there (a TOTP enrolment's encrypted seed, its recovery-code hashes and its
 * last used step, a passkey's public key, the tokens an OAuth provider
 * handed back), and the keys below are the ones an operator reads. A key
 * that is not listed cannot be serialized, whatever a handler returns.
 */
export const identityResourceSchema = identities.schema
  .omit({
    password: true,
    providerData: true,
  })
  .extend({
    providerData: z
      .object({
        // credentials
        mustChangePassword: z.boolean().optional(),
        // totp
        status: z.enum(["pending", "active"]).optional(),
        activatedAt: z.datetime().optional(),
        // passkey
        name: z.text({ size: "short" }).optional(),
        createdAt: z.datetime().optional(),
        lastUsedAt: z.datetime().optional(),
        backedUp: z.boolean().optional(),
        backupEligible: z.boolean().optional(),
        transports: z.array(z.shortText()).optional(),
        aaguid: z.text().optional(),
        rpId: z.text({ maxLength: 253 }).optional(),
        signCount: z.integer().optional(),
      })
      .optional(),
  });

export type IdentityResource = Infer<typeof identityResourceSchema>;
