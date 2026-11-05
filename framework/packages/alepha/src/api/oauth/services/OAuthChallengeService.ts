import { $inject, $store } from "alepha";
import { SecurityProvider, type UserAccount } from "alepha/security";

import { oauthOptions } from "../controllers/OAuthController.ts";

/**
 * What an MCP endpoint's authorization challenge says, from the scopes the
 * application declares (`oauthOptions.scopes`).
 *
 * The MCP transport is OAuth-agnostic: it asks through the
 * `mcp:auth:challenge:before` hook, and `$realm` answers with this service.
 */
export class OAuthChallengeService {
  protected readonly options = $store(oauthOptions);
  protected readonly security = $inject(SecurityProvider);

  /**
   * The `scope` of a 401 challenge (SEP-835): every declared scope that is
   * not an identity scope (`permissions: []`), space-separated; `mcp` when
   * the application declares none.
   */
  public unauthorizedScope(): string {
    const declared = Object.entries(this.options.scopes ?? {});
    if (declared.length === 0) {
      return "mcp";
    }
    const useful = declared
      .filter(([, scope]) => scope.permissions?.length !== 0)
      .map(([id]) => id);
    return (useful.length > 0 ? useful : ["mcp"]).join(" ");
  }

  /**
   * The step-up challenge for a caller missing permissions, or `undefined`
   * when re-authorizing would change nothing.
   *
   * It helps only when all of these hold:
   * - the token is narrowed by an OAuth grant (a `permissionScope`);
   * - every missing permission is refused by that scope, not by the user's
   *   roles: a user who may not do it at all gains nothing from consent;
   * - some declared scope grants each missing permission.
   *
   * The `scope` it names is the grant's own scopes (the token's `scope`
   * claim) plus those granting the missing permissions: a client
   * re-authorizes with the union, and never loses what it had.
   */
  public stepUp(
    user: UserAccount,
    permissions: string[],
  ): { scope: string; description: string } | undefined {
    if (user.permissionScope === undefined) {
      return undefined;
    }
    const missing = permissions.filter(
      (permission) =>
        this.security.checkUserPermission(user, permission).deniedBy ===
        "scope",
    );
    if (missing.length === 0) {
      return undefined;
    }
    const unscoped = { ...user, permissionScope: undefined };
    if (
      missing.some(
        (permission) =>
          !this.security.checkUserPermission(unscoped, permission).isAuthorized,
      )
    ) {
      return undefined;
    }

    const declared = Object.entries(this.options.scopes ?? {});
    const granting = new Set<string>();
    for (const permission of missing) {
      const ids = declared
        .filter(
          ([, scope]) =>
            scope.permissions !== undefined &&
            scope.permissions.length > 0 &&
            this.security.isInPermissionScope(permission, scope.permissions),
        )
        .map(([id]) => id);
      if (ids.length === 0) {
        return undefined;
      }
      for (const id of ids) granting.add(id);
    }

    const held =
      user.credential?.type === "oauth" ? (user.credential.scopes ?? []) : [];
    const scope = [...new Set([...held, ...granting])].join(" ");
    return {
      scope,
      description: `This call needs ${missing.join(", ")}, which the granted scopes do not include`,
    };
  }
}
