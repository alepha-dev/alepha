/**
 * A token could not be accepted: malformed, expired, or failing claim
 * validation.
 *
 * Status 401, not 403: this is an *authentication* failure, and 401 is what
 * tells a client to refresh or re-authenticate. 403 means "authenticated, but
 * not allowed" and belongs to authorization denials — answering it for an
 * expired token stops a refresh flow dead.
 */
export class InvalidTokenError extends Error {
  public name = "InvalidTokenError";
  public readonly status = 401;
}
