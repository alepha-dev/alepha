import { type Infer, z } from "alepha";

/**
 * A WebAuthn registration, as the browser's
 * `PublicKeyCredential.toJSON()` writes it after
 * `navigator.credentials.create()`: every binary field in base64url.
 *
 * Fields the verifier does not read (`publicKey`, `authenticatorData` and
 * `publicKeyAlgorithm` in `response`, which it derives from the attestation
 * object itself) are dropped.
 */
export const registrationResponseJsonSchema = z.object({
  id: z.text({ maxLength: 1400, trim: false }),
  rawId: z.text({ maxLength: 1400, trim: false }),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.text({ maxLength: 8192, trim: false }),
    attestationObject: z.text({ maxLength: 65536, trim: false }),
    transports: z.array(z.shortText()).optional(),
  }),
  authenticatorAttachment: z.shortText().optional(),
  clientExtensionResults: z.record(z.text(), z.any()).optional(),
});

export type RegistrationResponseJson = Infer<
  typeof registrationResponseJsonSchema
>;
