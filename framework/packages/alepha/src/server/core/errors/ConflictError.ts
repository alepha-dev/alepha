import { HttpError } from "./HttpError.ts";

/**
 * The request conflicts with the current state.
 */
export const ConflictError = HttpError.extend({
  name: "CONFLICT",
  default: { status: 409 },
  message: "Entity already exists",
});

export type ConflictError = InstanceType<typeof ConflictError>;
