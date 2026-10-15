import { UnauthorizedError } from "alepha/server";

/**
 * Error thrown when the provided credentials are invalid.
 *
 * Its message is fixed, and it carries no cause, so a refusal never says
 * which half of the credential was wrong.
 */
export const InvalidCredentialsError = UnauthorizedError.extend({
  name: "INVALID_CREDENTIALS",
  message: "Invalid credentials",
});

export type InvalidCredentialsError = InstanceType<
  typeof InvalidCredentialsError
>;
