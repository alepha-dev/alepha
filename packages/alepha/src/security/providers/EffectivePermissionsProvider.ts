import { $inject } from "alepha";

import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { SecurityProvider } from "./SecurityProvider.ts";

/**
 * The caller's **effective** permission set, computed once, server-side.
 *
 * ## Why the final answer and not the raw material
 *
 * Effective access is `application permission AND <whatever else narrows it>`.
 * The client could be sent the pieces and asked to intersect them, and that is
 * precisely what must not happen: two implementations of one rule, on two
 * sides of a wire, is how a sidebar and an endpoint come to disagree about who
 * may do something - and the disagreement is invisible until somebody with an
 * unusual rank complains that a button does nothing.
 *
 * So the client receives a flat list of short strings, its own, and its only
 * operation is `includes`.
 *
 * ## What is here and what is not
 *
 * Only the application layer is: the catalogue, the role grant, the privileged
 * bypass and the permission scope. Everything that narrows FURTHER is the
 * application's, passed in as {@link EffectivePermissionsOptions.narrow}. A
 * rank, a per-project capability, a subscription tier and a feature flag are
 * all the same shape from here, so adding one is a new predicate rather than a
 * change to this class.
 *
 * ## It performs no I/O, deliberately
 *
 * `resolve` is synchronous. Whatever a narrowing factor needs - a rank's
 * granted list, a row of entitlements - the caller has already read by the
 * time its gate ran, and passes in. An extraction that fetched would cost a
 * query on every path that uses it, which is the property being preserved:
 * a plain member costs no extra read.
 */
export class EffectivePermissionsProvider {
  protected readonly security = $inject(SecurityProvider);

  /**
   * The ids this caller effectively holds, as `group:name` strings, in
   * catalogue order.
   */
  public resolve(options: EffectivePermissionsOptions): string[] {
    const { user, narrow = [], exclude = [] } = options;

    const catalogue = this.ids(this.security.getPermissions()).filter(
      (id) => !exclude.some((prefix) => id.startsWith(prefix)),
    );

    /**
     * A privileged identity is not narrowed by the application's own factors,
     * matching `$owns`'s `ownership === false` bypass: an operator is not
     * being offered a button the application would hide, because there is no
     * page to put one on.
     *
     * A credential's permission scope still applies. The bypass is about the
     * application's factors, and a scoped key must not read the full set back
     * through it.
     */
    if (user.ownership === false) {
      return catalogue.filter((id) =>
        this.security.isInPermissionScope(id, user.permissionScope),
      );
    }

    // What the caller's roles grant, whatever resource they are looking at.
    const granted = new Set(this.ids(this.security.getPermissions(user)));

    return catalogue.filter(
      (id) => granted.has(id) && narrow.every((factor) => factor(id)),
    );
  }

  protected ids(permissions: { group?: string; name?: string }[]): string[] {
    return permissions
      .filter((it) => it.group && it.name)
      .map((it) => `${it.group}:${it.name}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface EffectivePermissionsOptions {
  /** The caller, with its roles, ownership flag and permission scope. */
  user: UserAccountToken;

  /**
   * What narrows the application answer further, each already holding
   * whatever it needs. Every one must accept an id for it to survive, and a
   * factor may only ever REMOVE: widening here would let an application
   * grant a permission its roles do not.
   */
  narrow?: ReadonlyArray<(permission: string) => boolean>;

  /**
   * Id prefixes the client is never told about, typically `admin:`. Left out
   * of the catalogue entirely rather than filtered per caller, so a
   * privileged identity does not read them back through the bypass.
   */
  exclude?: readonly string[];
}
