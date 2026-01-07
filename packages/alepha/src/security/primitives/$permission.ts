import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import { SecurityProvider } from "../providers/SecurityProvider.ts";
import type { UserAccount } from "../schemas/userAccountInfoSchema.ts";

/**
 * Create a new permission.
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
   */
  name?: string;

  /**
   * Group of the permission. Use Class name is not provided.
   */
  group?: string;

  /**
   * Describe the permission.
   */
  description?: string;
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
    });
  }

  /**
   * Check if the user has the permission.
   */
  public can(user?: UserAccount): boolean {
    if (!user?.roles) {
      return false;
    }
    const check = this.securityProvider.checkPermission(this, ...user.roles);
    return check.isAuthorized;
  }
}

$permission[KIND] = PermissionPrimitive;
