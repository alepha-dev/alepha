import { type Infer, z } from "alepha";

/**
 * What a server sends to start a WebAuthn registration: the JSON form of
 * `PublicKeyCredentialCreationOptions`, binary fields in base64url, as
 * `PublicKeyCredential.parseCreationOptionsFromJSON()` reads it.
 */
export const registrationOptionsJsonSchema = z.object({
  rp: z.object({
    id: z.text({ maxLength: 253 }).optional(),
    name: z.text(),
  }),
  user: z.object({
    id: z.text({ maxLength: 128, trim: false }),
    name: z.text(),
    displayName: z.text(),
  }),
  challenge: z.text({ maxLength: 128, trim: false }),
  pubKeyCredParams: z.array(
    z.object({ type: z.literal("public-key"), alg: z.integer() }),
  ),
  timeout: z.integer().optional(),
  excludeCredentials: z
    .array(
      z.object({
        type: z.literal("public-key"),
        id: z.text({ maxLength: 1400, trim: false }),
        transports: z.array(z.shortText()).optional(),
      }),
    )
    .optional(),
  authenticatorSelection: z
    .object({
      authenticatorAttachment: z
        .enum(["platform", "cross-platform"])
        .optional(),
      residentKey: z.enum(["discouraged", "preferred", "required"]).optional(),
      requireResidentKey: z.boolean().optional(),
      userVerification: z
        .enum(["discouraged", "preferred", "required"])
        .optional(),
    })
    .optional(),
  attestation: z.enum(["none", "indirect", "direct", "enterprise"]).optional(),
});

export type RegistrationOptionsJson = Infer<
  typeof registrationOptionsJsonSchema
>;
