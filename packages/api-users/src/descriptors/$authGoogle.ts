import { $context, t } from "@alepha/core";
import { $auth } from "@alepha/react-auth";
import type { RealmDescriptor } from "@alepha/security";
import { SessionService } from "../services/SessionService.ts";

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
export const $authGoogle = (realm: RealmDescriptor) => {
  const { alepha } = $context();
  const sessionService = alepha.inject(SessionService);

  const env = alepha.parseEnv(
    t.object({
      GOOGLE_CLIENT_ID: t.string(),
      GOOGLE_CLIENT_SECRET: t.string(),
    }),
  );

  return $auth({
    realm,
    name: "google",
    oidc: {
      issuer: "https://accounts.google.com",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      account: ({ user }) => sessionService.link("google", user),
    },
  });
};
