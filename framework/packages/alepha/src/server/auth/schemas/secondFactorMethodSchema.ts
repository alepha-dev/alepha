import { type Infer, z } from "alepha";

/**
 * A second authentication factor, checked after the primary credential.
 *
 * `passkey` is deliberately absent. WebAuthn needs a server-issued challenge
 * of its own, so it is a third verifier with its own routes
 * (`/_auth/passkey/options` and `/_auth/passkey/verify` with the challenge
 * token) rather than a widening of this union: a challenge says whether a
 * passkey may clear it in its `passkey` flag.
 */
export const secondFactorMethodSchema = z
  .enum(["totp", "emailCode"])
  .describe("A second authentication factor.");

export type SecondFactorMethod = Infer<typeof secondFactorMethodSchema>;
