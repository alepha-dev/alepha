import { $context, AlephaError, z } from "alepha";
import type { IssuerPrimitive } from "alepha/security";

import {
  $auth,
  type LinkAccountFn,
  type OidcOptions,
  type WithLinkFn,
} from "./$auth.ts";

/**
 * Creates an authentication provider primitive for France Connect.
 *
 * Uses OpenID Connect (OIDC) to authenticate users via France Connect,
 * the French government's identity federation system. It provides verified
 * identity data (name, email, birthdate) sourced directly from government
 * databases.
 *
 * **France Connect-specific behaviour**:
 * - Scopes use individual claim names (`given_name`, `family_name`) rather
 *   than the standard grouped `profile` scope.
 * - The `acr_values=eidas1` authorization parameter is mandatory and is
 *   included automatically.
 * - Logout is mandatory in France Connect integrations. Store the `id_token`
 *   returned at login and pass it to the logout endpoint when the session ends.
 *
 * **Environment Variables** (obtain from partenaires.franceconnect.gouv.fr):
 * - `FRANCECONNECT_CLIENT_ID`: OAuth 2.0 client ID for your France Connect service provider.
 * - `FRANCECONNECT_CLIENT_SECRET`: OAuth 2.0 client secret for your France Connect service provider.
 *
 * @example
 * ```ts
 * class AuthProviders {
 *   franceconnect = $authFranceConnect(this.userRealm);
 * }
 * ```
 */
export const $authFranceConnect = (
  realm: IssuerPrimitive & WithLinkFn,
  options: Partial<OidcOptions> = {},
) => {
  const { alepha } = $context();

  const env = alepha.parseEnv(
    z.object({
      FRANCECONNECT_CLIENT_ID: z
        .text({
          // Public: it travels in the authorize URL the browser is sent to.
          secret: false,
          description:
            "The OAuth 2.0 client ID for your France Connect service provider, obtained from partenaires.franceconnect.gouv.fr.",
        })
        .optional(),
      FRANCECONNECT_CLIENT_SECRET: z
        .text({
          description:
            "The OAuth 2.0 client secret for your France Connect service provider, obtained from partenaires.franceconnect.gouv.fr.",
        })
        .optional(),
    }),
  );

  const disabled =
    !env.FRANCECONNECT_CLIENT_ID || !env.FRANCECONNECT_CLIENT_SECRET;

  const name = "franceconnect";

  const account: LinkAccountFn | undefined =
    options.account ?? (realm.link ? realm.link(name) : undefined);

  if (!account) {
    throw new AlephaError(
      "Authentication requires a link function in the realm primitive.",
    );
  }

  return $auth({
    issuer: realm,
    name,
    oidc: {
      /**
       * France Connect production OIDC issuer.
       * Discovery: https://oidc.franceconnect.gouv.fr/api/v2/.well-known/openid-configuration
       *
       * Note: `oidc.franceconnect.gouv.fr` is standard FranceConnect (eidas1).
       * `auth.franceconnect.gouv.fr` is FranceConnect+ (eidas2/eidas3).
       */
      issuer: "https://oidc.franceconnect.gouv.fr/api/v2",
      clientId: env.FRANCECONNECT_CLIENT_ID!,
      clientSecret: env.FRANCECONNECT_CLIENT_SECRET,
      /**
       * France Connect requires individual claim names as scopes.
       * The standard grouped `profile` scope is NOT supported.
       */
      scope: "openid given_name family_name email",
      /**
       * `acr_values=eidas1` is mandatory for all France Connect integrations.
       */
      ...options,
      authorizationParameters: {
        acr_values: "eidas1",
        ...options.authorizationParameters,
      },
      account,
    },
    disabled,
  });
};
