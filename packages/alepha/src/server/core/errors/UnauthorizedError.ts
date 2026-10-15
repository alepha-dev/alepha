import { HttpError } from "./HttpError.ts";

/**
 * The caller is not authenticated, or its credential is refused.
 */
export const UnauthorizedError = HttpError.extend({
  name: "UNAUTHORIZED",
  default: { status: 401 },
  message: "Not allowed to access this resource",
});

export type UnauthorizedError = InstanceType<typeof UnauthorizedError>;
