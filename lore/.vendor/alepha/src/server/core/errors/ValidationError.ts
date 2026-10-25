import { HttpError } from "./HttpError.ts";

/**
 * The request does not match its schema; `details` names the path.
 */
export const ValidationError = HttpError.extend({
  name: "VALIDATION_FAILED",
  default: { status: 400 },
  message: "Validation has failed",
});

export type ValidationError = InstanceType<typeof ValidationError>;
