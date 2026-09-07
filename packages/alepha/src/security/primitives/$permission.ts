import { $inject, createPrimitive, KIND, Primitive } from "alepha";

import { SecurityProvider } from "../providers/SecurityProvider.ts";
import type { UserAccount } from "../schemas/userAccountInfoSchema.ts";

/**
 * Create a new permission.
 *
 * ## ⚠️ A permission's id is `group:name`, and it is a stable string
 *
 * Whatever grants this permission - a role, a stored profile, a per-resource
 * rank - stores that string. So `group` and `name` are an external identity,
 * not a label: renaming either one silently re-points every grant that held
 * the old string, and nothing anywhere goes red.
 *
 * The corollary is that an id must never be DERIVED from position. A
 * catalogue that numbers its permissions by their index in an array re-maps
 * every stored grant the moment somebody inserts one in the middle - and the
 * grants that move are not the ones being edited. This has a worked example:
 * a club whose receptionists woke up able to delete tournaments.
 *
 * Say what the permission is called with {@link PermissionPrimitiveOptions.label};
 * that is the string a reader sees, and it can be changed freely.
 */
export const $permission = (
  options: PermissionPrimitiveOptions = {},
): PermissionPrimitive => {
  return createPrimitive(PermissionPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface PermissionPrimitiveOptions {
  /**
   * Name of the permission. Use Property name is not provided.
   *
   * ⚠️ Part of the permission's stable id - see the note on {@link $permission}.
   */
  name?: string;

  /**
   * Group of the permission. Use Class name is not provided.
   *
   * ⚠️ Part of the permission's stable id - see the note on {@link $permission}.
   */
  group?: string;

  /**
   * Describe the permission.
   */
  description?: string;

  /**
   * Translation key for this permission's human-readable name.
   *
   * A key and not the text: an application whose UI is localised renders its
   * permission matrix in the reader's language, and `description` is a plain
   * string that cannot be. Unlike `name` and `group` this is free to change,
   * because nothing stores it.
   */
  label?: string;

  /**
   * Translation key for the human-readable name of this permission's GROUP.
   *
   * Declared here because a group has no declaration of its own: it exists
   * because permissions name it. Every permission in one group must agree,
   * and a disagreement is refused when the second one registers.
   */
  groupLabel?: string;

  /**
   * Where this permission's group sits in a matrix.
   *
   * A matrix reads as a list of sections, and alphabetical is not the order
   * anyone thinks in. Declared per permission for the same reason as
   * {@link groupLabel}; a group nobody ordered sorts after every group
   * somebody did.
   */
  groupOrder?: number;
}

// ---------------------------------------------------------------------------------------------------------------------

export class PermissionPrimitive extends Primitive<PermissionPrimitiveOptions> {
  protected readonly securityProvider = $inject(SecurityProvider);

  public get name(): string {
    return this.options.name || this.config.propertyKey;
  }

  public get group(): string {
    return this.options.group || this.config.service.name;
  }

  public toString(): string {
    return `${this.group}:${this.name}`;
  }

  protected onInit() {
    this.securityProvider.createPermission({
      name: this.name,
      group: this.group,
      description: this.options.description,
      label: this.options.label,
      groupLabel: this.options.groupLabel,
      groupOrder: this.options.groupOrder,
    });
  }

  /**
   * Check if the user has the permission.
   *
   * Role names are resolved inside the user's own realm. Without that scope,
   * a realm whose "admin" grants nothing would inherit the permissions of
   * whichever homonymous role another realm declared first.
   */
  public can(user?: UserAccount & { realm?: string }): boolean {
    if (!user?.roles) {
      return false;
    }
    const check = this.securityProvider.checkPermissionInRealm(
      user.realm,
      this,
      ...user.roles,
    );
    return check.isAuthorized;
  }
}

$permission[KIND] = PermissionPrimitive;
