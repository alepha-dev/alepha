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
   * - A scope DECLARED with no `permissions` (for its copy only) leaves the
   *   WHOLE grant unrestricted: the application said so, and the boot
   *   warning below names it.
   *
   * **Once the application declares any scope, the rest fails closed**
   * (#Q2514). A scope it never declared contributes nothing, and a grant
   * naming no scope reaches no permission-checked route. Both used to mean
   * "unrestricted", which turned a self-registered client asking for a
   * made-up scope, or a device asking for none, into a token acting with
   * the user's full roles, past every narrowing the declared scopes exist
   * for.
   *
   * An application that declares no scope at all keeps the old reading, an
   * unrestricted grant: every connected app is on that branch until its
   * application declares its scopes, and must keep working on upgrade.
   */
  public resolve(scopes: string[]): string[] | undefined {
    const declared = this.options.scopes ?? {};
    const declares = Object.keys(declared).length > 0;

    if (scopes.length === 0) {
      return declares ? [] : undefined;
    }

    const permissions = new Set<string>();

    for (const id of scopes) {
      const scope = declared[id];
      if (!scope) {
        if (declares) {
          continue;
        }
        return undefined;
      }
      const list = scope.permissions;
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
