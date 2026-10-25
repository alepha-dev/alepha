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
 * Already configured GitHub authentication primitive.
 *
 * Uses OAuth2 to authenticate users via their GitHub accounts.
 * Upon successful authentication, it links the GitHub account to a user session.
 *
 * Environment Variables:
 * - `GITHUB_CLIENT_ID`: The client ID obtained from the GitHub Developer Settings.
 * - `GITHUB_CLIENT_SECRET`: The client secret obtained from the GitHub Developer Settings.
 */
export const $authGithub = (
  realm: IssuerPrimitive & WithLinkFn,
  options: Partial<OidcOptions> = {},
) => {
  const { alepha } = $context();

  const env = alepha.parseEnv(
    z.object({
      GITHUB_CLIENT_ID: z
        .text({
          // Public: it travels in the authorize URL the browser is sent to.
          secret: false,
          description:
            "The OAuth App client ID obtained from GitHub Developer Settings.",
        })
        .optional(),
      GITHUB_CLIENT_SECRET: z
        .text({
          description:
            "The OAuth App client secret obtained from GitHub Developer Settings.",
        })
        .optional(),
    }),
  );

  const disabled = !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET;

  const name = "github";

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
      clientId: env.GITHUB_CLIENT_ID!,
      clientSecret: env.GITHUB_CLIENT_SECRET!,
      authorization: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      scope: "read:user user:email",
      userinfo: async (tokens) => {
        const BASE_URL = "https://api.github.com";
        const headers = {
          Authorization: `Bearer ${tokens.access_token}`,
          "User-Agent": "Alepha",
        };
        const res = await fetch(`${BASE_URL}/user`, { headers }).then((res) =>
          res.json(),
        );

        const user: OAuth2Profile = {
          sub: res.id.toString(),
        };

        if (res.email) {
          user.email = res.email;
        }

        if (res.name) {
          user.name = res.name.trim();
        }

        if (res.avatar_url) {
          user.picture = res.avatar_url;
        }

        // `/user` omits the email if the user's public profile hides it, and
        // never exposes `verified`. Fetch `/user/emails` to fill in both.
        const emailsRes = await fetch(`${BASE_URL}/user/emails`, { headers });
        if (emailsRes.ok) {
          const emails: Array<{
            email: string;
            primary: boolean;
            verified: boolean;
          }> = await emailsRes.json();
          if (!user.email) {
            user.email = (emails.find((e) => e.primary) ?? emails[0])?.email;
          }
          if (user.email) {
            user.email_verified =
              emails.find((e) => e.email === user.email)?.verified ?? false;
          }
        }

        return user;
      },
      ...options,
      account,
    },
    disabled,
  });
};
