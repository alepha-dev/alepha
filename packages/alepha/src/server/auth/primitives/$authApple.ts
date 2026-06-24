import { $context, AlephaError, z } from "alepha";
import type { IssuerPrimitive } from "alepha/security";
import type { OAuth2Profile } from "../providers/ServerAuthProvider.ts";
import {
  $auth,
  type LinkAccountFn,
  type LinkAccountOptions,
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
 * - `response_mode=form_post` (required by Apple when requesting `email`/`name`).
 * - Scope: `name email` (Apple does not support the standard `profile` scope).
 * - The user's name is only provided on the first authorization, as a `user`
 *   form field on the POST callback. The framework extracts it and injects
 *   `given_name` / `family_name` / `name` into the profile before linking.
 *   Subsequent logins only return `sub` and `email` in the ID token.
 * - `email_verified` and `is_private_email` are normalized from Apple's
 *   string ("true"/"false") representation to booleans.
 *
 * Client secret:
 * Apple requires the client secret to be a signed ES256 JWT generated from
 * your Apple private key, team ID, and key ID. This JWT is valid for up to 6
 * months; you must rotate it before expiration. Generate it out of band and
 * set it via `APPLE_CLIENT_SECRET`.
 *
 * See: https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret
 *
 * Environment Variables:
 * - `APPLE_CLIENT_ID`: The Service ID obtained from the Apple Developer Console.
 * - `APPLE_CLIENT_SECRET`: The signed ES256 JWT client secret generated from your
 *   Apple private key.
 */
export const $authApple = (
  realm: IssuerPrimitive & WithLinkFn,
  options: Partial<OidcOptions> = {},
) => {
  const { alepha } = $context();

  const env = alepha.parseEnv(
    z.object({
      APPLE_CLIENT_ID: z
        .text({
          description:
            "The Service ID obtained from the Apple Developer Console.",
        })
        .optional(),
      APPLE_CLIENT_SECRET: z
        .text({
          description:
            "The signed ES256 JWT client secret generated from your Apple private key.",
        })
        .optional(),
    }),
  );

  const disabled = !env.APPLE_CLIENT_ID || !env.APPLE_CLIENT_SECRET;

  const name = "apple";

  const userAccount: LinkAccountFn | undefined =
    options.account ?? (realm.link ? realm.link(name) : undefined);

  if (!userAccount) {
    throw new AlephaError(
      "Authentication requires a link function in the realm primitive.",
    );
  }

  const account: LinkAccountFn = async (opts) => {
    return userAccount(normalizeApplePayload(opts));
  };

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

/**
 * Normalize Apple-specific profile quirks before handing off to the
 * user-provided link function.
 *
 * Why: Apple's ID token non-conformities — `email_verified` and
 * `is_private_email` are delivered as the strings "true"/"false" rather than
 * booleans. Normalize so downstream code can rely on standard OIDC shapes.
 */
const normalizeApplePayload = (
  opts: LinkAccountOptions,
): LinkAccountOptions => {
  const user: OAuth2Profile = { ...opts.user };

  for (const key of ["email_verified", "is_private_email"] as const) {
    const raw = user[key] as unknown;
    if (typeof raw === "string") {
      user[key] = raw === "true";
    }
  }

  return { ...opts, user };
};
