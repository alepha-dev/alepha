import { HttpError } from "./HttpError.ts";

/**
 * The resource does not exist.
 */
export const NotFoundError = HttpError.extend({
  name: "NOT_FOUND",
  default: { status: 404 },
  message: "Resource not found",
});

export type NotFoundError = InstanceType<typeof NotFoundError>;
