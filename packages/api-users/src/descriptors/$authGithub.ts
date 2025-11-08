import { $context, t } from "@alepha/core";
import { $auth, type OAuth2Profile } from "@alepha/react-auth";
import type { RealmDescriptor } from "@alepha/security";
import { SessionService } from "../services/SessionService.ts";

/**
 * Already configured GitHub authentication descriptor.
 *
 * Uses OAuth2 to authenticate users via their GitHub accounts.
 * Upon successful authentication, it links the GitHub account to a user session.
 *
 * Environment Variables:
 * - `GITHUB_CLIENT_ID`: The client ID obtained from the GitHub Developer Settings.
 * - `GITHUB_CLIENT_SECRET`: The client secret obtained from the GitHub Developer Settings.
 */
export const $authGithub = (realm: RealmDescriptor) => {
  const { alepha } = $context();
  const sessionService = alepha.inject(SessionService);

  const env = alepha.parseEnv(
    t.object({
      GITHUB_CLIENT_ID: t.string(),
      GITHUB_CLIENT_SECRET: t.string(),
    }),
  );

  return $auth({
    realm,
    name: "github",
    oauth: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      authorization: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      scope: "read:user user:email",
      userinfo: async (tokens) => {
        const BASE_URL = "https://api.github.com";
        const res = await fetch(`${BASE_URL}/user`, {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            "User-Agent": "Alepha",
          },
        }).then((res) => res.json());

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

        if (!user.email) {
          const res = await fetch(`${BASE_URL}/user/emails`, {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              "User-Agent": "Alepha",
            },
          });
          if (res.ok) {
            const emails: any[] = await res.json();
            user.email = (emails.find((e) => e.primary) ?? emails[0]).email;
          }
        }

        return user;
      },
      account: ({ user }) => sessionService.link("github", user),
    },
  });
};
