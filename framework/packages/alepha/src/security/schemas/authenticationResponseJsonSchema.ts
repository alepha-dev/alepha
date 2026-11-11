import { type Infer, z } from "alepha";

/**
 * A WebAuthn assertion, as the browser's `PublicKeyCredential.toJSON()`
 * writes it after `navigator.credentials.get()`: every binary field in
 * base64url. `userHandle` is the user id the relying party set at
 * registration, present for a discoverable credential.
 */
export const authenticationResponseJsonSchema = z.object({
  id: z.text({ maxLength: 1400, trim: false }),
  rawId: z.text({ maxLength: 1400, trim: false }),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.text({ maxLength: 8192, trim: false }),
    authenticatorData: z.text({ maxLength: 8192, trim: false }),
    signature: z.text({ maxLength: 2048, trim: false }),
    userHandle: z.text({ maxLength: 128, trim: false }).optional(),
  }),
  authenticatorAttachment: z.shortText().optional(),
  clientExtensionResults: z.record(z.text(), z.any()).optional(),
});

export type AuthenticationResponseJson = Infer<
  typeof authenticationResponseJsonSchema
>;
