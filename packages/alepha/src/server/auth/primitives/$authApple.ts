import { $context, AlephaError, t } from "alepha";
import type { IssuerPrimitive } from "alepha/security";
import {
  $auth,
  type LinkAccountFn,
  type OidcOptions,
  type WithLinkFn,
} from "./$auth.ts";

/**
 * Already configured Apple authentication primitive.
 *
 * Uses OpenID Connect (OIDC) to authenticate users via their Apple accounts.
 * Upon successful authentication, it links the Apple account to a user session.
 *
 * Apple-specific behavior:
 * - Uses `response_mode=form_post` (required by Apple for email/name scopes).
 * - Scopes: `name email` (Apple does not support the standard `profile` scope).
 * - User's name is only provided on the first authorization. Subsequent logins
 *   only return `sub` and `email` in the ID token.
 * - The client secret must be a signed ES256 JWT generated from your Apple private key.
 *
 * Environment Variables:
 * - `APPLE_CLIENT_ID`: The Service ID obtained from the Apple Developer Console.
 * - `APPLE_CLIENT_SECRET`: The signed JWT client secret generated from your Apple private key.
 */
export const $authApple = (
  realm: IssuerPrimitive & WithLinkFn,
  options: Partial<OidcOptions> = {},
) => {
  const { alepha } = $context();

  const env = alepha.parseEnv(
    t.object({
      APPLE_CLIENT_ID: t.optional(
        t.text({
          description:
            "The Service ID obtained from the Apple Developer Console.",
        }),
      ),
      APPLE_CLIENT_SECRET: t.optional(
        t.text({
          description:
            "The signed JWT client secret generated from your Apple private key.",
        }),
      ),
    }),
  );

  const disabled = !env.APPLE_CLIENT_ID || !env.APPLE_CLIENT_SECRET;

  const name = "apple";

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
      issuer: "https://appleid.apple.com",
      clientId: env.APPLE_CLIENT_ID!,
      clientSecret: env.APPLE_CLIENT_SECRET,
      scope: "name email",
      responseMode: "form_post",
      ...options,
      account,
    },
    disabled,
  });
};
