import { HttpError } from "./HttpError.ts";

/**
 * The caller is authenticated but not allowed.
 */
export const ForbiddenError = HttpError.extend({
  name: "FORBIDDEN",
  default: { status: 403 },
  message: "No permission to access this resource",
});

export type ForbiddenError = InstanceType<typeof ForbiddenError>;
