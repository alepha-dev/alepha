import { z } from "alepha";
import { ForbiddenError } from "alepha/server";

/**
 * A permission name that does not match the permission grammar.
 *
 * A `ForbiddenError` (403), so it answers like every other security error if
 * one ever reaches a response. In practice it is thrown while permissions and
 * roles are declared, so it fails the boot.
 */
export const InvalidPermissionError = ForbiddenError.extend({
  name: "INVALID_PERMISSION",
  schema: z.object({ permission: z.text({ size: "long" }) }),
  message: (data) => `Permission '${data.permission}' is invalid`,
});

export type InvalidPermissionError = InstanceType<
  typeof InvalidPermissionError
>;
