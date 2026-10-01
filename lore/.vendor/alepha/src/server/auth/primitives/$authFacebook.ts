import { $context, AlephaError, z } from "alepha";
import type { IssuerPrimitive } from "alepha/security";

import type { OAuth2Profile } from "../providers/ServerAuthProvider.ts";
import {
  $auth,
  type LinkAccountFn,
  type OidcOptions,
  type WithLinkFn,
} from "./$auth.ts";

/**
 * Already configured Facebook authentication primitive.
 *
 * Uses OAuth2 to authenticate users via their Facebook accounts.
 * Upon successful authentication, it links the Facebook account to a user session.
 *
 * Environment Variables:
 * - `FACEBOOK_CLIENT_ID`: The App ID obtained from the Meta Developer Console.
 * - `FACEBOOK_CLIENT_SECRET`: The App Secret obtained from the Meta Developer Console.
 */
export const $authFacebook = (
  realm: IssuerPrimitive & WithLinkFn,
  options: Partial<OidcOptions> = {},
) => {
  const { alepha } = $context();

  const env = alepha.parseEnv(
    z.object({
      FACEBOOK_CLIENT_ID: z
        .text({
          // Public: it travels in the authorize URL the browser is sent to.
          secret: false,
          description: "The App ID obtained from the Meta Developer Console.",
        })
        .optional(),
      FACEBOOK_CLIENT_SECRET: z
        .text({
          description:
            "The App Secret obtained from the Meta Developer Console.",
        })
        .optional(),
    }),
  );

  const disabled = !env.FACEBOOK_CLIENT_ID || !env.FACEBOOK_CLIENT_SECRET;

  const name = "facebook";

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
    oauth: {
      clientId: env.FACEBOOK_CLIENT_ID!,
      clientSecret: env.FACEBOOK_CLIENT_SECRET!,
      authorization: "https://www.facebook.com/v25.0/dialog/oauth",
      token: "https://graph.facebook.com/v25.0/oauth/access_token",
      scope: "email",
      userinfo: async (tokens) => {
        const res = await fetch(
          "https://graph.facebook.com/v25.0/me?fields=id,name,email,picture.width(200).height(200)",
          {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
            },
          },
        ).then((res) => res.json());

        const user: OAuth2Profile = {
          sub: res.id,
        };

        if (res.email) {
          user.email = res.email;
        }

        if (res.name) {
          user.name = res.name.trim();
        }

        if (res.picture?.data?.url) {
          user.picture = res.picture.data.url;
        }

        return user;
      },
      ...options,
      account,
    },
    disabled,
  });
};
