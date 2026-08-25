import { $inject, AlephaError, createPrimitive, KIND, Primitive } from "alepha";

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

  /**
   * The realm this role belongs to. Omitted, the role is attached to every
   * realm, including realms declared after it.
   */
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
    const issuer = this.options.issuer;
    const realm =
      issuer == null
        ? undefined
        : typeof issuer === "string"
          ? issuer
          : issuer.name;

    // An $issuer referenced by value resolves only once the container has
    // walked its property. A `$role` sitting ABOVE it in the same class reads
    // `undefined` (the field does not exist yet) or "" (the name is assigned
    // with the property key), and the role would then attach to every realm
    // instead of one - silently, which is the whole point of naming an issuer.
    // The key being present is what separates "named an issuer" from "named
    // none", since both end up `undefined`.
    if ("issuer" in this.options && !realm) {
      throw new AlephaError(
        `Role '${this.name}' names an $issuer that could not be resolved. ` +
          `Declare the $issuer before the $role, or name its realm as a string.`,
      );
    }

    this.securityProvider.createRole(
      {
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
      },
      ...(realm ? [realm] : []),
    );
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
