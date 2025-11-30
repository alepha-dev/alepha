import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import { SecurityProvider } from "../providers/SecurityProvider.ts";
import type { PermissionPrimitive } from "./$permission.ts";
import type { RealmPrimitive } from "./$realm.ts";

/**
 * Create a new role.
 */
export const $role = (options: RolePrimitiveOptions = {}): RolePrimitive => {
  return createPrimitive(RolePrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RolePrimitiveOptions {
  /**
   * Name of the role.
   */
  name?: string;

  /**
   * Describe the role.
   */
  description?: string;

  realm?: string | RealmPrimitive;

  permissions?: Array<
    | string
    | {
        name: string;
        ownership?: boolean;
        exclude?: string[];
      }
  >;
}

export class RolePrimitive extends Primitive<RolePrimitiveOptions> {
  protected readonly securityProvider = $inject(SecurityProvider);

  public get name(): string {
    return this.options.name || this.config.propertyKey;
  }

  protected onInit() {
    this.securityProvider.createRole({
      ...this.options,
      name: this.name,
      permissions:
        this.options.permissions?.map((it) => {
          if (typeof it === "string") {
            return {
              name: it,
            };
          }

          return it;
        }) ?? [],
    });
  }

  /**
   * Get the realm of the role.
   */
  public get realm(): string | RealmPrimitive | undefined {
    return this.options.realm;
  }

  public can(permission: string | PermissionPrimitive): boolean {
    return this.securityProvider.can(this.name, permission);
  }

  public check(permission: string | PermissionPrimitive) {
    return this.securityProvider.checkPermission(permission, this.name);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

$role[KIND] = RolePrimitive;
