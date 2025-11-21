import { $context, AlephaError, t } from "alepha";
import type { RealmDescriptor } from "alepha/security";
import {
  $auth,
  type LinkAccountFn,
  type OidcOptions,
  type WithLinkFn,
} from "./$auth.ts";

/**
 * Already configured Google authentication descriptor.
 *
 * Uses OpenID Connect (OIDC) to authenticate users via their Google accounts.
 * Upon successful authentication, it links the Google account to a user session.
 *
 * Environment Variables:
 * - `GOOGLE_CLIENT_ID`: The client ID obtained from the Google Developer Console.
 * - `GOOGLE_CLIENT_SECRET`: The client secret obtained from the Google Developer Console.
 */
export const $authGoogle = (
  realm: RealmDescriptor & WithLinkFn,
  options: Partial<OidcOptions> = {},
) => {
  const { alepha } = $context();

  const env = alepha.parseEnv(
    t.object({
      GOOGLE_CLIENT_ID: t.string(),
      GOOGLE_CLIENT_SECRET: t.string(),
    }),
  );

  const name = "google";

  const account: LinkAccountFn | undefined =
    options.account ?? (realm.link ? realm.link(name) : undefined);

  if (!account) {
    throw new AlephaError(
      "Authentication requires a link function in the realm descriptor.",
    );
  }

  return $auth({
    realm,
    name,
    oidc: {
      issuer: "https://accounts.google.com",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      ...options,
      account,
    },
  });
};
