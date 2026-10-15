import { UnauthorizedError } from "alepha/server";

import { mfaChallengeSchema } from "../schemas/mfaChallengeSchema.ts";

/**
 * Raised when the primary credential checked out but the realm wants a
 * second factor before it hands over a session.
 *
 * Deliberately a 401 carrying structured `data` rather than a 200 with a
 * different body: the token route keeps its exact response contract, so no
 * existing client breaks. Declared with `$error`, so `HttpClient` rebuilds it
 * in the browser and a caller branches with `error instanceof MfaRequiredError`,
 * `error.data` typed as a {@link MfaChallenge} (plus the HTTP fields).
 *
 * The `challenge` is a signed, short-lived assertion that the password was
 * verified. It grants nothing on its own.
 */
export const MfaRequiredError = UnauthorizedError.extend({
  name: "MFA_REQUIRED",
  schema: mfaChallengeSchema,
  message: "A second authentication factor is required",
});

export type MfaRequiredError = InstanceType<typeof MfaRequiredError>;
