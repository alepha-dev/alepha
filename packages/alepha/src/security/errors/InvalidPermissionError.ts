import { ForbiddenError } from "alepha/server";

/**
 * A permission name that does not match the permission grammar.
 *
 * A `ForbiddenError` (403), so it answers like every other security error if
 * one ever reaches a response. In practice it is thrown while permissions and
 * roles are declared, so it fails the boot.
 */
export class InvalidPermissionError extends ForbiddenError {
  constructor(name: string) {
    super(`Permission '${name}' is invalid`);
  }
}
