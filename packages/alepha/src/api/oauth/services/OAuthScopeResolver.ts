import { $hook, $store } from "alepha";
import { $logger } from "alepha/logger";

import { oauthOptions } from "../controllers/OAuthController.ts";

/**
 * Turns an OAuth grant's scope ids into the permissions its tokens may use.
 *
 * The declarations live in `oauthOptions.scopes`, each with an optional
 * `permissions` list. `$realm` hands {@link resolve} to its issuer, which
 * calls it every time it mints an access token for a grant: on the code and
 * device grants, and on every refresh from the scope ids stored on the
 * session. The result becomes the token's `permissionScope`, which
 * `SecurityProvider` enforces for every permission-checked route.
 */
export class OAuthScopeResolver {
  protected readonly log = $logger();
  protected readonly options = $store(oauthOptions);

  /**
   * The permission list a grant of these scopes is limited to, or `undefined`
   * when the grant stays unrestricted.
   *
   * - The reach is the union of the scopes' declared lists.
   * - A scope declared with `permissions: []` (an identity scope such as
   *   `openid`) contributes nothing, so a grant made only of such scopes
   *   reaches no permission-checked route.
   * - A scope with no `permissions` declaration, declared for its copy only or
   *   not declared at all, leaves the WHOLE grant unrestricted. Every existing
   *   connected app is on that branch until its application declares its
   *   scopes, and must keep working on upgrade.
   * - A grant naming no scope at all is unrestricted for the same reason: the
   *   device flow grants an empty list to a device that asks for nothing.
   */
  public resolve(scopes: string[]): string[] | undefined {
    if (scopes.length === 0) {
      return undefined;
    }

    const declared = this.options.scopes ?? {};
    const permissions = new Set<string>();

    for (const id of scopes) {
      const list = declared[id]?.permissions;
      if (list === undefined) {
        return undefined;
      }
      for (const permission of list) {
        permissions.add(permission);
      }
    }

    return [...permissions];
  }

  /**
   * Says at boot which declared scopes narrow nothing, because the gap is
   * otherwise invisible: a scope declared for its consent copy alone grants
   * its tokens everything the user's roles do.
   */
  protected readonly warnUnrestrictedScopes = $hook({
    on: "start",
    handler: () => {
      for (const [id, scope] of Object.entries(this.options.scopes ?? {})) {
        if (scope.permissions === undefined) {
          this.log.warn(
            `OAuth scope '${id}' declares no permissions: a token granted it acts with its user's full roles`,
          );
        }
      }
    },
  });
}
