import { UnauthorizedError } from "alepha/server";

/**
 * Error thrown when the provided credentials are invalid.
 *
 * Message can not be changed to avoid leaking information.
 * Cause is omitted for the same reason.
 */
export class InvalidCredentialsError extends UnauthorizedError {
  readonly name = "UnauthorizedError";
  constructor() {
    super("Invalid credentials");
  }
}
