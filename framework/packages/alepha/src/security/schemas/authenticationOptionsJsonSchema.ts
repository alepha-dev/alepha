import { type Infer, z } from "alepha";

/**
 * What a server sends to start a WebAuthn assertion: the JSON form of
 * `PublicKeyCredentialRequestOptions`, binary fields in base64url, as
 * `PublicKeyCredential.parseRequestOptionsFromJSON()` reads it. An empty
 * `allowCredentials` asks for a discoverable credential: the authenticator
 * offers the accounts it holds for the RP id.
 */
export const authenticationOptionsJsonSchema = z.object({
  challenge: z.text({ maxLength: 128, trim: false }),
  rpId: z.text({ maxLength: 253 }).optional(),
  timeout: z.integer().optional(),
  allowCredentials: z
    .array(
      z.object({
        type: z.literal("public-key"),
        id: z.text({ maxLength: 1400, trim: false }),
        transports: z.array(z.shortText()).optional(),
      }),
    )
    .optional(),
  userVerification: z.enum(["discouraged", "preferred", "required"]).optional(),
});

export type AuthenticationOptionsJson = Infer<
  typeof authenticationOptionsJsonSchema
>;
