import { HttpError } from "./HttpError.ts";

/**
 * The server failed in a way the caller cannot act on. A strict `$action` answers any undeclared error with it; the router strips its message and cause in production.
 */
export const InternalServerError = HttpError.extend({
  name: "INTERNAL_SERVER_ERROR",
  default: { status: 500 },
  message: "Internal Server Error",
});

export type InternalServerError = InstanceType<typeof InternalServerError>;
