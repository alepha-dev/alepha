import { HttpError } from "./HttpError.ts";

/**
 * A request the server refuses as malformed.
 */
export const BadRequestError = HttpError.extend({
  name: "BAD_REQUEST",
  default: { status: 400 },
  message: "Invalid request body",
});

export type BadRequestError = InstanceType<typeof BadRequestError>;
