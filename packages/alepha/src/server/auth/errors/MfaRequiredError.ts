import { $error } from "alepha/server";

import { mfaChallengeSchema } from "../schemas/mfaChallengeSchema.ts";

/**
 * Raised when the primary credential checked out but the realm wants a
 * second factor before it hands over a session.
 *
 * Deliberately a 401 carrying structured `data` rather than a 200 with a
 * different body: the token route keeps its exact response contract, so no
 * existing client breaks. An `$error` constant, so `HttpClient` rebuilds it
 * in the browser and a caller branches with
 * `error instanceof MfaRequiredError`, `error.data` typed as a
 * {@link MfaChallenge}.
 *
 * The `challenge` is a signed, short-lived assertion that the password was
 * verified. It grants nothing on its own.
 */
export const MfaRequiredError = $error({
  code: "MfaRequiredError",
  status: 401,
  message: "A second authentication factor is required",
  data: mfaChallengeSchema,
});

export type MfaRequiredError = InstanceType<typeof MfaRequiredError>;
