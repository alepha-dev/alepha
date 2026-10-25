import { ForbiddenError } from "alepha/server";

/**
 * A security rule refused the operation: a missing role or permission, a
 * provider or realm that refuses the request.
 */
export const SecurityError = ForbiddenError.extend({
  name: "SECURITY",
});

export type SecurityError = InstanceType<typeof SecurityError>;
