import { $context } from "alepha";
import { t } from "alepha";
import type { IssuerPrimitive } from "alepha/security";
import { $route, BadRequestError } from "alepha/server";
import {
  type VerifyAssertionOptions,
  verifyFederationAssertion,
} from "../helpers/federationAssertion.ts";
import { JtiReplayGuard } from "../helpers/jtiReplayGuard.ts";
import { safeRedirectPath } from "../helpers/safeRedirectPath.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";
import type { LinkAccountOptions, WithLinkFn } from "./$auth.ts";

export async function assertionToProfile(
  token: string,
  opts: VerifyAssertionOptions,
): Promise<{ provider: string; jti: string; link: LinkAccountOptions }> {
  const { profile, jti } = await verifyFederationAssertion(token, opts);
  return {
    provider: profile.provider,
    jti,
    link: {
      access_token: "", // federated: no upstream token retained
      user: {
        sub: profile.sub,
        email: profile.email,
        email_verified: profile.email_verified,
        name: profile.name,
        given_name: profile.given_name,
        family_name: profile.family_name,
        picture: profile.picture,
      },
    },
  };
}

export interface FederationClientOptions {
  realm: IssuerPrimitive & WithLinkFn;
  brokerUrl: string; // assertion issuer
  publicKeyPem: string;
  selfOrigin?: string; // optional override; otherwise derived from the request host
}

export const $authFederationClient = (options: FederationClientOptions) => {
  const { alepha } = $context();
  const replay = new JtiReplayGuard(); // single-use, bounded (assertions ~60s)

  const callback = $route({
    path: "/auth/federated/callback",
    schema: {
      query: t.object({
        token: t.text({ size: "rich" }),
        redirect: t.optional(t.text({ size: "long" })),
      }),
    },
    handler: async ({ query, url, reply, cookies }) => {
      const serverAuth = alepha.inject(ServerAuthProvider);
      const audience = options.selfOrigin ?? `${url.protocol}//${url.host}`;
      const { provider, jti, link } = await assertionToProfile(query.token, {
        publicKeyPem: options.publicKeyPem,
        issuer: options.brokerUrl,
        audience,
      });
      if (!replay.check(jti)) {
        throw new BadRequestError("Assertion already used");
      }

      if (!options.realm.link) {
        throw new BadRequestError("Realm has no link function");
      }
      const user = await options.realm.link(provider)(link);
      await serverAuth.establishSession(user, options.realm, provider, cookies);

      reply.redirect(safeRedirectPath(query.redirect), 302);
    },
  });

  return { callback };
};
