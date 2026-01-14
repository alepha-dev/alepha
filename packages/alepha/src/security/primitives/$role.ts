import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import { SecurityProvider } from "../providers/SecurityProvider.ts";
import type { IssuerPrimitive } from "./$issuer.ts";
import type { PermissionPrimitive } from "./$permission.ts";

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

  issuer?: string | IssuerPrimitive;

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
   * Get the issuer of the role.
   */
  public get issuer(): string | IssuerPrimitive | undefined {
    return this.options.issuer;
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
