import { $audit } from "alepha/api/audits";

/**
 * User-management audit events.
 *
 * Holds the `user` audit type. Mirrors the `$notification`/`$job` holder
 * pattern (see {@link UserNotifications}) — register as a module variant and
 * log via the exposed primitive: `userAudits(realm)?.user.log("create", …)`.
 */
export class UserAudits {
  public readonly user = $audit({
    type: "user",
    description:
      "User management events (create, update, delete, role/password changes).",
    actions: [
      "create",
      "update",
      "delete",
      "role_change",
      "password_change",
      "enable",
      "disable",
    ],
  });
}
