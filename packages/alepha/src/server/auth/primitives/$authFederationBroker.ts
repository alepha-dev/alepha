import { AlephaError, t } from "alepha";
import { SecurityError } from "alepha/security";
import { $route, BadRequestError } from "alepha/server";
import { $cookie } from "alepha/server/cookies";
import { safeRedirectPath } from "../helpers/safeRedirectPath.ts";
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  type Configuration,
  discovery,
  randomPKCECodeVerifier,
  randomState,
} from "openid-client";
import { signAppleClientSecret } from "../helpers/appleClientSecret.ts";
import {
  type FederationProfile,
  signFederationAssertion,
} from "../helpers/federationAssertion.ts";

export interface FederationBrokerProviders {
  google?: { clientId: string; clientSecret: string };
  apple?: {
    serviceId: string;
    teamId: string;
    keyId: string;
    privateKeyPem: string;
  };
}

export interface FederationBrokerOptions {
  /** Broker public origin, e.g. https://alepha.club — becomes the assertion `iss`. */
  issuer: string;
  /** EdDSA PKCS#8 PEM — signs assertions. */
  signingKeyPem: string;
  providers: FederationBrokerProviders;
  /** Validate the requested tenant and return its exact origin (or null to reject). */
  resolveTenant: (tenant: string) => Promise<string | null>;
  assertionTtlSeconds?: number;
}

const ISSUERS = {
  google: "https://accounts.google.com",
  apple: "https://appleid.apple.com",
} as const;

export const $authFederationBroker = (options: FederationBrokerOptions) => {
  const callbackPath = "/auth/federated/callback";

  if (!options.signingKeyPem) {
    throw new AlephaError("$authFederationBroker requires signingKeyPem");
  }

  // Per-flow cookie: carries the tenant + PKCE/state across the redirect.
  const flow = $cookie({
    name: "federationFlow",
    ttl: [15, "minutes"],
    httpOnly: true,
    encrypt: true,
    schema: t.object({
      provider: t.text(),
      tenantOrigin: t.text({ size: "long" }),
      redirectPath: t.text({ size: "long" }),
      codeVerifier: t.optional(t.text({ size: "long" })),
      state: t.optional(t.text()),
      nonce: t.optional(t.text()),
    }),
  });

  const callbackUri = `${options.issuer}${callbackPath}`;

  // Build an openid-client Configuration for a provider. Apple's client_secret
  // is signed fresh on every call (~5min) — no static secret, no rotation.
  const getConfig = async (
    provider: "google" | "apple",
  ): Promise<Configuration> => {
    if (provider === "google") {
      const g = options.providers.google;
      if (!g) {
        throw new SecurityError("google federation not configured");
      }
      return discovery(new URL(ISSUERS.google), g.clientId, g.clientSecret);
    }
    const a = options.providers.apple;
    if (!a) {
      throw new SecurityError("apple federation not configured");
    }
    const clientSecret = await signAppleClientSecret({
      privateKeyPem: a.privateKeyPem,
      teamId: a.teamId,
      serviceId: a.serviceId,
      keyId: a.keyId,
    });
    return discovery(new URL(ISSUERS.apple), a.serviceId, clientSecret);
  };

  const scopeFor = (provider: string) =>
    provider === "apple" ? "name email" : "openid email profile";

  const start = $route({
    path: "/auth/federated/start",
    schema: {
      query: t.object({
        provider: t.text(),
        tenant: t.text(),
        redirect: t.optional(t.text({ size: "long" })),
      }),
    },
    handler: async ({ query, reply, cookies }) => {
      if (query.provider !== "google" && query.provider !== "apple") {
        throw new BadRequestError(`Unsupported provider '${query.provider}'`);
      }
      const tenantOrigin = await options.resolveTenant(query.tenant);
      if (!tenantOrigin) {
        throw new BadRequestError("Unknown or inactive tenant");
      }

      const config = await getConfig(query.provider);
      const codeVerifier = randomPKCECodeVerifier();
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
      const parameters: Record<string, string> = {
        redirect_uri: callbackUri,
        scope: scopeFor(query.provider),
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      };
      // Apple needs response_mode=form_post when requesting name/email scopes.
      if (query.provider === "apple") {
        parameters.response_mode = "form_post";
      }

      const usePkce = config.serverMetadata().supportsPKCE();
      let state: string | undefined;
      let nonce: string | undefined;
      if (!usePkce) {
        state = randomState();
        nonce = randomState();
        parameters.state = state;
        parameters.nonce = nonce;
        delete parameters.code_challenge;
        delete parameters.code_challenge_method;
      }

      flow.set(
        {
          provider: query.provider,
          tenantOrigin,
          redirectPath: safeRedirectPath(query.redirect),
          codeVerifier: usePkce ? codeVerifier : undefined,
          state,
          nonce,
        },
        { cookies },
      );
      reply.redirect(buildAuthorizationUrl(config, parameters).toString(), 302);
    },
  });

  const handle = async (
    urlOrReq: URL | Request,
    cookies: any,
    reply: any,
    rawProfile?: Record<string, unknown>,
  ) => {
    const ctx = flow.get({ cookies });
    if (!ctx) {
      throw new BadRequestError("Missing federation flow");
    }
    flow.del({ cookies });

    const provider = ctx.provider as "google" | "apple";

    let profile: FederationProfile;
    try {
      const config = await getConfig(provider);
      const tokens = await authorizationCodeGrant(config, urlOrReq, {
        pkceCodeVerifier: ctx.codeVerifier,
        expectedState: ctx.state,
        expectedNonce: ctx.nonce,
      });

      // Verified claims come from the id_token; merge Apple's one-time form_post name.
      const claims = (tokens.claims?.() ?? {}) as Record<string, unknown>;
      const merged = { ...rawProfile, ...claims } as Record<string, unknown>;
      profile = {
        provider,
        sub: String(merged.sub),
        email: merged.email as string | undefined,
        email_verified:
          typeof merged.email_verified === "string"
            ? merged.email_verified === "true"
            : (merged.email_verified as boolean | undefined),
        name: merged.name as string | undefined,
        given_name: merged.given_name as string | undefined,
        family_name: merged.family_name as string | undefined,
        picture: merged.picture as string | undefined,
        is_private_email:
          typeof merged.is_private_email === "string"
            ? merged.is_private_email === "true"
            : (merged.is_private_email as boolean | undefined),
      };
    } catch {
      // Upstream auth failed or the user denied consent — bounce back to the
      // tenant with an error rather than surfacing a raw 500.
      const fail = new URL(`${ctx.tenantOrigin}${ctx.redirectPath}`);
      fail.searchParams.set("error", "federation_failed");
      reply.redirect(fail.toString(), 302);
      return;
    }

    const assertion = await signFederationAssertion(profile, {
      privateKeyPem: options.signingKeyPem,
      issuer: options.issuer,
      audience: ctx.tenantOrigin,
      ttlSeconds: options.assertionTtlSeconds,
    });

    const dest = new URL(`${ctx.tenantOrigin}/auth/federated/callback`);
    dest.searchParams.set("token", assertion);
    dest.searchParams.set("redirect", ctx.redirectPath);
    reply.redirect(dest.toString(), 302);
  };

  const callback = $route({
    path: callbackPath,
    handler: async ({ url, reply, cookies }) => handle(url, cookies, reply),
  });

  // Apple posts the result (form_post). Extract its one-time `user` (name/email)
  // before openid-client consumes the body.
  const callbackPost = $route({
    path: callbackPath,
    method: "POST",
    handler: async ({ reply, cookies, raw }) => {
      let rawProfile: Record<string, unknown> | undefined;
      let req: Request | URL = raw?.web?.req as Request;
      if (raw?.web?.req) {
        const cloned = raw.web.req.clone();
        req = raw.web.req;
        try {
          const form = await cloned.formData();
          const userField = form.get("user");
          if (typeof userField === "string") {
            const parsed = JSON.parse(userField) as {
              name?: { firstName?: string; lastName?: string };
              email?: string;
            };
            rawProfile = {};
            if (parsed.name?.firstName) {
              rawProfile.given_name = parsed.name.firstName;
            }
            if (parsed.name?.lastName) {
              rawProfile.family_name = parsed.name.lastName;
            }
            if (parsed.name?.firstName || parsed.name?.lastName) {
              rawProfile.name = [parsed.name?.firstName, parsed.name?.lastName]
                .filter(Boolean)
                .join(" ");
            }
            if (parsed.email) {
              rawProfile.email = parsed.email;
            }
          }
        } catch {
          // ignore — name is optional on repeat logins
        }
      }
      await handle(req, cookies, reply, rawProfile);
    },
  });

  return { start, callback, callbackPost };
};
