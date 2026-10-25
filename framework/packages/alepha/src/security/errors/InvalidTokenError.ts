import { UnauthorizedError } from "alepha/server";

/**
 * A token could not be accepted: malformed, expired, or failing claim
 * validation.
 *
 * An `UnauthorizedError` (401), not a 403: this is an *authentication*
 * failure, and 401 is what tells a client to refresh or re-authenticate. 403
 * means "authenticated, but not allowed" and belongs to authorization
 * denials; answering it for an expired token stops a refresh flow dead.
 */
export const InvalidTokenError = UnauthorizedError.extend({
  name: "INVALID_TOKEN",
  message: "Invalid token",
});

export type InvalidTokenError = InstanceType<typeof InvalidTokenError>;
