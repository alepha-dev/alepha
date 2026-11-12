import { $permission } from "alepha/security";

/**
 * The permission of the operator-side avatar endpoints, declared apart from
 * `AdminAvatarController` (#Q3404).
 *
 * A `$permission` fills the registry roles are validated against at boot, so
 * the class holding it is created at boot. Declared here, the controller holds
 * only actions and is created on its first request. Registered with it, by
 * `$realm({ features: { avatars: true } })`.
 */
export class AvatarPermissions {
  // Group and name apart, so it files as the `admin:user:avatar` the
  // routes' `$secure` checks. Written as one `name`, it was filed under the
  // declaring class (`AdminAvatarController:admin:user:avatar`), a second
  // entry nothing checked.
  public readonly avatarPermission = $permission({
    group: "admin:user",
    name: "avatar",
    description: "Manage another user's avatar",
  });
}
