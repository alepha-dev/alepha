import { type Infer, z } from "alepha";

/**
 * What a passkey keeps in `identities.providerData`. The row itself has
 * `provider: "passkey"` and the credential id, base64url, in
 * `providerUserId`, whose unique index with `provider` makes a credential
 * enrol once.
 *
 * Nothing here is secret: a public key and a counter. Stored in the JSON
 * column, as TOTP is, so passkeys cost no migration.
 */
export const passkeyIdentityDataSchema = z.object({
  publicKey: z.object({
    kty: z.enum(["EC", "RSA", "OKP"]),
    alg: z.enum(["ES256", "RS256", "EdDSA"]),
    crv: z.enum(["P-256", "Ed25519"]).optional(),
    x: z.text({ maxLength: 128, trim: false }).optional(),
    y: z.text({ maxLength: 128, trim: false }).optional(),
    n: z.text({ maxLength: 2048, trim: false }).optional(),
    e: z.text({ maxLength: 16, trim: false }).optional(),
  }),
  signCount: z.integer(),
  transports: z.array(z.shortText()),
  aaguid: z.text(),
  backupEligible: z.boolean(),
  backedUp: z.boolean(),
  rpId: z
    .text({ maxLength: 253 })
    .describe(
      "The relying party id the passkey was made for. A passkey made for another host is listed and removable, and signs in nowhere.",
    ),
  name: z.text({ size: "short" }),
  createdAt: z.datetime(),
  lastUsedAt: z.datetime().optional(),
});

export type PasskeyIdentityData = Infer<typeof passkeyIdentityDataSchema>;
