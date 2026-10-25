import { type Infer, z } from "alepha";

/**
 * A second authentication factor, checked after the primary credential.
 *
 * `passkey` is deliberately absent. WebAuthn needs a server-issued challenge
 * of its own, so it will arrive as a third verifier with its own routes
 * rather than by widening this union and pretending it fits.
 */
export const secondFactorMethodSchema = z
  .enum(["totp", "emailCode"])
  .describe("A second authentication factor.");

export type SecondFactorMethod = Infer<typeof secondFactorMethodSchema>;
