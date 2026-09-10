import { $atom, $inject, $store, Alepha, AlephaError, z } from "alepha";
import { $cache } from "alepha/cache";
import { DatabaseCacheProvider } from "alepha/cache/database";
import { $logger } from "alepha/logger";
import { JwtProvider } from "alepha/security";
import { $route, HttpError } from "alepha/server";

import {
  type ConsentScope,
  renderConsentPage,
} from "../helpers/consentPage.ts";
import { renderDevicePage } from "../helpers/devicePage.ts";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
} from "../helpers/oauthMetadata.ts";
import { buildOpenIdConfiguration } from "../helpers/oidcMetadata.ts";
import { authorizeDecisionBodySchema } from "../schemas/authorizeDecisionBodySchema.ts";
import { authorizeQuerySchema } from "../schemas/authorizeQuerySchema.ts";
import { deviceAuthorizationBodySchema } from "../schemas/deviceAuthorizationBodySchema.ts";
import { deviceDecisionBodySchema } from "../schemas/deviceDecisionBodySchema.ts";
import { deviceVerificationQuerySchema } from "../schemas/deviceVerificationQuerySchema.ts";
import { oauthScopeCopySchema } from "../schemas/oauthScopeCopySchema.ts";
import { registerClientBodySchema } from "../schemas/registerClientBodySchema.ts";
import { tokenRequestBodySchema } from "../schemas/tokenRequestBodySchema.ts";
import {
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  DeviceCodeService,
} from "../services/DeviceCodeService.ts";
import { OAuthClientService } from "../services/OAuthClientService.ts";

/**
 * Configuration for the OAuth authorization server.
 * `realm` is the issuer realm whose JWTs are minted as access tokens;
 * `resource` is the path of the protected MCP endpoint;
 * `loginPath` is the app-level login page unauthenticated users are
 * redirected to from the authorize endpoint.
 */
export const oauthOptions = $atom({
  name: "alepha.api.oauth.options",
  description: "Configuration for the OAuth authorization server.",
  schema: z.object({
    realm: z.text({ default: "users" }),
    resource: z.text({ default: "/mcp" }),
    loginPath: z.text({ default: "/login" }),
    /**
     * Page where a human approves a device authorization (RFC 8628). Handed to
     * the device as `verification_uri` so it can print it.
     *
     * Defaults to `/oauth/device`, which this controller serves. Point it
     * elsewhere only to hand the step to a page of the app's own; the built-in
     * one stays mounted either way.
     *
     * ⚠️ It defaulted to `/device` until #Q2217, a page nothing served: every
     * code a device printed led to a 404 and could never be approved. The
     * built-in page lives under `/oauth/` rather than at `/device` because a
     * root segment claimed by a module is claimed in every app that mounts
     * it - in Lore, a root segment is also a project slug.
     *
     * Optional so adding it does not break every existing caller of
     * `alepha.set(oauthOptions, …)` — the sibling fields are required, and any
     * app already configuring them would stop compiling.
     */
    devicePath: z.text({ default: "/oauth/device" }).optional(),
    /**
     * The app's own name, shown on the consent screen as the party being
     * connected to ("Claude wants access to your Lore account").
     *
     * ⚠️ Deliberately NOT defaulted to `APP_NAME`. That variable is a log
     * prefix - Lore sets it to `RDM` - so falling back to it would put an
     * initialism where a product name goes, on the one page a third party
     * sees. Unset means the screen omits the identity rather than inventing
     * one.
     */
    productName: z.text().optional(),
    /**
     * Where a user revokes a granted connection, e.g. `/account/connections`.
     * Linked from the consent screen when set, and never guessed: the page is
     * `@alepha/ui`'s account router, which an app may not mount at all.
     */
    connectionsPath: z.text().optional(),
    /**
     * What each scope MEANS, keyed by scope identifier.
     *
     * A scope id is a wire token, and printing it at somebody about to grant
     * it tells them nothing - Lore's screen listed one bullet reading `mcp`.
     * Only the app knows what its own scopes reach, so the copy is declared
     * here rather than shipped with the framework. An undeclared scope falls
     * back to its raw identifier, which is what the screen did for all of
     * them before.
     */
    scopes: z.record(z.string(), oauthScopeCopySchema).optional(),
  }),
  default: {
    realm: "users",
    resource: "/mcp",
    loginPath: "/login",
    devicePath: "/oauth/device",
  },
  serverOnly: true,
});

/**
 * OAuth 2.1 authorization server endpoints: discovery metadata, RFC 7591
 * dynamic client registration, authorization, token and RFC 8628 device
 * authorization, with the page a human approves a device on.
 */
export class OAuthController {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly options = $store(oauthOptions);
  protected readonly clients = $inject(OAuthClientService);
  protected readonly deviceCodes = $inject(DeviceCodeService);
  protected readonly jwt = $inject(JwtProvider);

  /**
   * Absolute origin of the current request, e.g. https://app.com.
   */
  protected baseUrl(url: URL): string {
    return `${url.protocol}//${url.host}`;
  }

  /**
   * The scopes about to be granted, each with whatever copy the app declared
   * for it.
   *
   * The identifier is carried through even when a label exists: it is what
   * the issued token will actually contain, and the screen shows it beside
   * the label so a reader who knows the protocol can check one against the
   * other. A scope with no declared copy falls back to its identifier, which
   * is exactly what every scope did before this existed.
   */
  protected describeScopes(scopes: string[]): ConsentScope[] {
    const copy = this.options.scopes ?? {};
    return scopes.map((id) => ({ id, ...copy[id] }));
  }

  /**
   * Host of the client's redirect URI, for the consent screen.
   *
   * The one part of a client's identity this server can vouch for. A
   * `clientName` is whatever the client wrote at registration and a hostile
   * one can claim any name it likes; the redirect URI is where the
   * authorization code is actually delivered, and it was validated against
   * the registration before this page is rendered.
   *
   * Returns `undefined` rather than the raw string if it will not parse, so
   * a malformed value is omitted instead of printed as identity.
   */
  protected redirectHost(redirectUri: string): string | undefined {
    try {
      return new URL(redirectUri).host || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Whether a post came from a page on this host.
   *
   * The device approval POST needs this and the consent POST does not. A
   * forged consent can only mint a code bound by PKCE, which the forger cannot
   * redeem. A forged device approval hands the forger's own device a token for
   * the victim's account, with nothing left to redeem.
   *
   * The session cookie is `SameSite=Lax`, which already keeps a cross-SITE
   * post from carrying it. This closes what Lax leaves open: a sibling on the
   * same site (another subdomain) posting with the victim's cookie attached.
   * Every browser sends `Origin` on a form post, so a post naming no origin
   * at all is refused rather than trusted.
   *
   * Hosts are compared, not whole origins, so a proxy that terminates TLS
   * without forwarding the scheme cannot refuse every legitimate post.
   */
  protected isSameOrigin(headers: Record<string, string>, url: URL): boolean {
    const source = headers.origin ?? headers.referer;
    if (!source) return false;
    try {
      return new URL(source).host === url.host;
    } catch {
      // `Origin: null` - a sandboxed frame, a privacy-sensitive redirect.
      return false;
    }
  }

  /**
   * One answer for every code the approval page will not act on.
   *
   * Unknown, expired, already answered and throttled all read the same, so
   * the page is not an oracle for which codes exist. `DeviceCodeService`
   * holds the same line for the first three.
   */
  protected readonly deviceCodeRefused =
    "That code is not valid, has expired, or has already been used. Start again on your device to get a new one.";

  metadata = $route({
    method: "GET",
    path: "/.well-known/oauth-authorization-server",
    handler: ({ url, reply }) => {
      reply.headers["content-type"] = "application/json";
      reply.body = JSON.stringify(
        buildAuthorizationServerMetadata(this.baseUrl(url)),
      );
    },
  });

  protectedResource = $route({
    method: "GET",
    path: "/.well-known/oauth-protected-resource",
    handler: ({ url, reply }) => {
      const base = this.baseUrl(url);
      reply.headers["content-type"] = "application/json";
      reply.body = JSON.stringify(
        buildProtectedResourceMetadata(base, `${base}${this.options.resource}`),
      );
    },
  });

  openidConfiguration = $route({
    method: "GET",
    path: "/.well-known/openid-configuration",
    handler: ({ url, reply }) => {
      reply.headers["content-type"] = "application/json";
      reply.body = JSON.stringify(buildOpenIdConfiguration(this.baseUrl(url)));
    },
  });

  jwks = $route({
    method: "GET",
    path: "/oauth/jwks",
    handler: async ({ reply }) => {
      reply.headers["content-type"] = "application/json";
      reply.body = JSON.stringify(await this.jwt.getJwks(this.options.realm));
    },
  });

  /**
   * Per-address budget for dynamic client registration.
   *
   * DCR is unauthenticated by design (RFC 7591 allows it, and an MCP client
   * discovering this server has no credential yet), which leaves the write
   * path open: every call creates a row, and nothing bounded how many.
   *
   * The SQL-backed cache, for the same reason the registration limiter uses
   * it: `incr()` is atomic there, and Cloudflare KV coalesces concurrent
   * writes to one key, which is precisely the burst a limiter exists to stop.
   */
  protected readonly registerRateLimit = $cache<number>({
    provider: DatabaseCacheProvider,
    name: "api:oauth:dcr-rate-limit",
    ttl: [15, "minutes"],
  });

  /**
   * How many clients one address may register per window. Conservative: a
   * real client registers ONCE and keeps its id, so anything above a handful
   * is a retry loop or an attack, never normal use.
   */
  protected readonly registerMaxPerWindow = 10;

  /**
   * Which budget a registration is counted against.
   *
   * No address is not a reason to skip the budget. `getRequestIp` answers
   * `undefined` without `TRUST_PROXY` on any runtime with no socket to fall
   * back to, and this used to skip the limiter ENTIRELY — leaving an
   * unauthenticated write path with nothing in front of it, and no log to say
   * so.
   *
   * One shared bucket keeps the unattributable registrations bounded, and
   * costs nothing real: a genuine client registers once and keeps its id, so
   * a budget of ten shared between them is not a limit anybody meets by
   * accident.
   *
   * A method rather than two lines in the handler, because the branch that
   * matters is the one an HTTP test cannot reach: a request over a real
   * socket always has a connection IP.
   */
  protected registrationBucket(ip: string | undefined): string {
    if (ip) return ip;
    this.log.warn(
      "Dynamic client registration with no client address; counting it against the shared bucket. Set TRUST_PROXY if this app is behind a proxy.",
    );
    return "unknown";
  }

  register = $route({
    method: "POST",
    path: "/oauth/register",
    schema: { body: registerClientBodySchema },
    handler: async ({ body, reply }) => {
      // Read off the request atom, the same way the registration limiter
      // reaches the address: a `$route` handler's context does not carry it.
      const ip = this.alepha.store.get("alepha.http.request")?.ip;

      // No address is not a reason to skip the budget. `getRequestIp` answers
      // `undefined` without `TRUST_PROXY` on any runtime with no socket to
      // fall back to, and this used to skip the limiter ENTIRELY — leaving an
      // unauthenticated write path with nothing in front of it, and no log to
      // say so. One shared bucket keeps the unattributable registrations
      // bounded, and costs nothing real: a genuine client registers once and
      // keeps its id, so a budget of ten between them is not a constraint
      // anybody meets by accident.
      const bucket = this.registrationBucket(ip);

      // Asked, not inferred. A disabled cache answers `incr` with `1`, which
      // is indistinguishable from a first call, so the limiter cannot detect
      // its own absence through the count. `cacheOptions.enabled` is an
      // operator-facing atom, so turning caching off — a reasonable thing to
      // do while debugging — silently removed the only bound on this
      // endpoint.
      if (!this.registerRateLimit.enabled) {
        if (this.alepha.isProduction()) {
          // Refuse rather than serve it unprotected. DCR is unauthenticated,
          // and an unbounded row count is the failure this limiter exists for.
          throw new HttpError({
            message:
              "Client registration is unavailable: its rate limiter requires the cache, which is disabled.",
            status: 503,
          });
        }
        // Outside production, a developer running with caching off should
        // still be able to register a client.
        this.log.warn(
          "Cache is disabled, so dynamic client registration is unbounded. Do not run this configuration in production.",
        );
      }

      const count = await this.registerRateLimit.incr(`dcr:ip:${bucket}`);
      if (count > this.registerMaxPerWindow) {
        this.log.warn("Dynamic client registration rate limit exceeded", {
          ip: bucket,
        });
        // 429, not the 400 the registration limiter answers: a caller that
        // waits and retries is doing the right thing, and only this status
        // says so.
        throw new HttpError({
          message: "Too many client registrations, please try again later",
          status: 429,
        });
      }

      const client = await this.clients.register({
        realm: this.options.realm,
        clientName: body.client_name ?? "MCP Client",
        redirectUris: body.redirect_uris,
        scopes: body.scope ? body.scope.split(" ") : ["mcp"],
        source: "dcr",
      });
      reply.status = 201;
      reply.headers["content-type"] = "application/json";
      reply.body = JSON.stringify({
        client_id: client.clientId,
        client_id_issued_at: Math.floor(
          new Date(client.createdAt).getTime() / 1000,
        ),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "none",
      });
    },
  });

  /**
   * GET /oauth/authorize — OAuth 2.1 authorization request. If the user
   * has no session, redirect to the realm login page with a return URL.
   * If authenticated, render the consent screen.
   */
  authorize = $route({
    method: "GET",
    path: "/oauth/authorize",
    schema: { query: authorizeQuerySchema },
    use: [],
    handler: async ({ query, user, url, reply }) => {
      if (query.response_type !== "code") {
        reply.status = 400;
        reply.body = "unsupported response_type";
        return;
      }
      if (query.code_challenge_method !== "S256") {
        reply.status = 400;
        reply.body = "code_challenge_method must be S256";
        return;
      }
      const client = await this.clients.findByClientId(query.client_id);
      if (!client || client.revokedAt) {
        reply.status = 400;
        reply.body = "unknown client_id";
        return;
      }
      if (!this.clients.isRedirectUriAllowed(client, query.redirect_uri)) {
        reply.status = 400;
        reply.body = "redirect_uri not registered";
        return;
      }
      const silent = query.prompt === "none";
      // Consent is skipped ONLY for trusted first-party clients (the AS's own
      // product — consent is for third-party apps). A non-silent trusted client
      // still sends an unauthenticated user through login first; it just never
      // shows the "wants to connect" page.
      //
      // `prompt` is attacker-controlled and must never widen this. OIDC Core
      // §3.1.2.1 defines `prompt=none` as "display no UI", and requires
      // `consent_required` when the client has no pre-configured consent — it
      // does not mean "consent is granted". Letting it skip consent turned any
      // self-registered DCR client plus one link into a silent account takeover.
      const skipConsent = client.trusted === true;

      if (!user) {
        if (silent) {
          // Silent SSO with no IdP session → OIDC `login_required`.
          const redirect = new URL(query.redirect_uri);
          redirect.searchParams.set("error", "login_required");
          if (query.state) redirect.searchParams.set("state", query.state);
          reply.redirect(redirect.toString(), 302);
          return;
        }
        const returnTo = encodeURIComponent(url.pathname + url.search);
        reply.redirect(
          `${this.options.loginPath}?redirect_uri=${returnTo}`,
          302,
        );
        return;
      }

      if (silent && !skipConsent) {
        // Authenticated, but this client has no standing consent and we are
        // forbidden from asking for it (OIDC Core §3.1.2.6). The client is
        // expected to retry without `prompt=none`, which shows the screen.
        const redirect = new URL(query.redirect_uri);
        redirect.searchParams.set("error", "consent_required");
        if (query.state) redirect.searchParams.set("state", query.state);
        reply.redirect(redirect.toString(), 302);
        return;
      }

      if (skipConsent) {
        // Authenticated + trusted client → skip consent and mint the code
        // directly (first-party login).
        const code = await this.clients.createAuthorizationCode(
          this.options.realm,
          {
            userId: user.id,
            clientId: query.client_id,
            redirectUri: query.redirect_uri,
            codeChallenge: query.code_challenge,
            scopes: this.clients.intersectScopes(
              query.scope?.split(" "),
              client.scopes,
            ),
            resource: query.resource || undefined,
            nonce: query.nonce,
          },
        );
        const redirect = new URL(query.redirect_uri);
        redirect.searchParams.set("code", code);
        if (query.state) redirect.searchParams.set("state", query.state);
        reply.redirect(redirect.toString(), 302);
        return;
      }

      reply.headers["content-type"] = "text/html; charset=utf-8";
      reply.body = renderConsentPage({
        clientName: client.clientName,
        userName: user.name ?? user.email ?? "your account",
        // Show the user the scopes they will actually grant, not the raw
        // (possibly over-broad) request.
        scopes: this.describeScopes(
          this.clients.intersectScopes(query.scope?.split(" "), client.scopes),
        ),
        productName: this.options.productName,
        redirectHost: this.redirectHost(query.redirect_uri),
        connectionsUrl: this.options.connectionsPath,
        hidden: {
          response_type: query.response_type,
          client_id: query.client_id,
          redirect_uri: query.redirect_uri,
          code_challenge: query.code_challenge,
          code_challenge_method: query.code_challenge_method,
          scope: query.scope ?? "",
          state: query.state ?? "",
          resource: query.resource ?? "",
          nonce: query.nonce ?? "",
        },
      });
    },
  });

  /**
   * POST /oauth/authorize — consent decision. On "allow", mint an
   * authorization code and redirect back to the client's redirect_uri.
   *
   * CSRF: this route carries no CSRF token and relies solely on the session
   * cookie to identify the user. This is a deliberate MVP/MCP tradeoff — a
   * forged consent submit can still only issue an authorization code to an
   * already-registered client, and that code is bound by PKCE, so the
   * attacker cannot redeem it without the matching code_verifier.
   */
  authorizeDecision = $route({
    method: "POST",
    path: "/oauth/authorize",
    schema: { body: authorizeDecisionBodySchema },
    use: [],
    handler: async ({ body, user, reply }) => {
      if (!user) {
        reply.status = 401;
        reply.body = "authentication required";
        return;
      }
      const client = await this.clients.findByClientId(body.client_id);
      if (
        !client ||
        client.revokedAt ||
        !this.clients.isRedirectUriAllowed(client, body.redirect_uri)
      ) {
        reply.status = 400;
        reply.body = "invalid client";
        return;
      }
      const redirect = new URL(body.redirect_uri);
      if (body.decision !== "allow") {
        redirect.searchParams.set("error", "access_denied");
        if (body.state) redirect.searchParams.set("state", body.state);
        reply.redirect(redirect.toString(), 302);
        return;
      }
      const code = await this.clients.createAuthorizationCode(
        this.options.realm,
        {
          userId: user.id,
          clientId: body.client_id,
          redirectUri: body.redirect_uri,
          codeChallenge: body.code_challenge,
          scopes: this.clients.intersectScopes(
            body.scope?.split(" "),
            client.scopes,
          ),
          resource: body.resource || undefined,
          nonce: body.nonce,
        },
      );
      redirect.searchParams.set("code", code);
      if (body.state) redirect.searchParams.set("state", body.state);
      reply.redirect(redirect.toString(), 302);
    },
  });

  /**
   * POST /oauth/device_authorization — RFC 8628 §3.2.
   *
   * Unauthenticated on purpose: the device has no credential yet, which is the
   * situation the grant exists for. What protects it is that a code is worth
   * nothing until a human with a session approves it.
   */
  deviceAuthorization = $route({
    method: "POST",
    path: "/oauth/device_authorization",
    schema: { body: deviceAuthorizationBodySchema },
    use: [],
    handler: async ({ body, url, reply }) => {
      reply.headers["content-type"] = "application/json";
      const record = await this.deviceCodes.start({
        clientId: body.client_id ?? "cli",
        scopes: (body.scope ?? "").split(" ").filter(Boolean),
        resource: body.resource,
      });
      const base = this.baseUrl(url);
      const verificationUri = `${base}${this.options.devicePath ?? "/oauth/device"}`;
      reply.body = JSON.stringify({
        device_code: record.deviceCode,
        user_code: record.userCode,
        verification_uri: verificationUri,
        // RFC 8628 §3.3.1: the same page with the code pre-filled, so anyone
        // who CAN follow a link is spared retyping it. The plain URI is still
        // required, for whoever cannot.
        verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(record.userCode)}`,
        expires_in: DEVICE_CODE_TTL_SECONDS,
        interval: DEVICE_POLL_INTERVAL_SECONDS,
      });
    },
  });

  /**
   * GET /oauth/device - the page a human approves a device on (RFC 8628
   * §3.3), and the default `verification_uri`.
   *
   * No session: through the login page and back, with the same
   * `redirect_uri` parameter `/oauth/authorize` uses, so an app's login page
   * needs one bridge for both. No code: a form to type one. A code: the
   * confirm screen, or the form again with a refusal.
   *
   * A lookup counts against the signed-in user, so this is the path
   * `DEVICE_USER_CODE_MAX_ATTEMPTS` guards: someone guessing codes here is
   * someone with a session, typing.
   */
  devicePage = $route({
    method: "GET",
    path: "/oauth/device",
    schema: { query: deviceVerificationQuerySchema },
    use: [],
    handler: async ({ query, user, url, reply }) => {
      if (!user) {
        const returnTo = encodeURIComponent(url.pathname + url.search);
        reply.redirect(
          `${this.options.loginPath}?redirect_uri=${returnTo}`,
          302,
        );
        return;
      }

      reply.headers["content-type"] = "text/html; charset=utf-8";
      // It names the account, and the code in it is live for ten minutes.
      reply.headers["cache-control"] = "no-store";
      const productName = this.options.productName;

      if (!query.user_code) {
        reply.body = renderDevicePage({ step: "enter", productName });
        return;
      }

      const record = await this.deviceCodes.byUserCode(
        query.user_code,
        user.id,
      );
      if (!record || record.status !== "pending") {
        reply.body = renderDevicePage({
          step: "enter",
          userCode: query.user_code,
          error: this.deviceCodeRefused,
          productName,
        });
        return;
      }

      reply.body = renderDevicePage({
        step: "confirm",
        // The canonical form, not what was typed: it is what the device
        // shows, and comparing the two is the whole point of the screen.
        userCode: record.userCode,
        userName: user.name ?? user.email ?? "your account",
        // What the device asked for, which is what it will get. Nothing
        // narrows a device grant's scopes, so the screen must not either.
        scopes: this.describeScopes(record.scopes),
        productName,
      });
    },
  });

  /**
   * POST /oauth/device - the answer from the approval page.
   *
   * ⚠️ Unlike the consent POST, this one checks where it came from: see
   * {@link isSameOrigin}. The origin is checked before the session, so a
   * forged post learns nothing about whether its victim was signed in.
   */
  deviceDecision = $route({
    method: "POST",
    path: "/oauth/device",
    schema: { body: deviceDecisionBodySchema },
    use: [],
    handler: async ({ body, user, url, headers, reply }) => {
      if (!this.isSameOrigin(headers, url)) {
        reply.status = 403;
        reply.body = "cross-origin request refused";
        return;
      }
      if (!user) {
        reply.status = 401;
        reply.body = "authentication required";
        return;
      }

      reply.headers["content-type"] = "text/html; charset=utf-8";
      reply.headers["cache-control"] = "no-store";
      const productName = this.options.productName;

      try {
        await this.deviceCodes.decide(
          body.user_code,
          body.decision === "allow" ? "approve" : "deny",
          user.id,
        );
      } catch (error) {
        // `decide` refuses an unknown, expired or already answered code with
        // an AlephaError. Anything else is a real failure and must reach the
        // error handler rather than read as a bad code.
        if (!(error instanceof AlephaError)) throw error;
        reply.body = renderDevicePage({
          step: "enter",
          userCode: body.user_code,
          error: this.deviceCodeRefused,
          productName,
        });
        return;
      }

      reply.body = renderDevicePage({
        step: "done",
        decision: body.decision,
        productName,
      });
    },
  });

  /**
   * POST /oauth/token — supports the `authorization_code` grant (verifies
   * PKCE, mints an access token via the realm issuer) and the
   * `refresh_token` grant (exchanges a refresh token for a fresh access
   * token, so a client stays connected without re-running the flow).
   */
  token = $route({
    method: "POST",
    path: "/oauth/token",
    schema: { body: tokenRequestBodySchema },
    use: [],
    handler: async ({ body, url, reply }) => {
      reply.headers["content-type"] = "application/json";
      try {
        if (body.grant_type === "authorization_code") {
          const client = await this.clients.findByClientId(
            body.client_id ?? "",
          );
          if (!client || client.revokedAt) {
            reply.status = 400;
            reply.body = JSON.stringify({ error: "invalid_client" });
            return;
          }
          if (client.type === "confidential") {
            const ok = await this.clients.verifySecret(
              client.clientId,
              body.client_secret ?? "",
            );
            if (!ok) {
              reply.status = 401;
              reply.body = JSON.stringify({ error: "invalid_client" });
              return;
            }
          }
          const grant = await this.clients.consumeAuthorizationCode(
            this.options.realm,
            body.code ?? "",
            {
              clientId: body.client_id ?? "",
              redirectUri: body.redirect_uri ?? "",
              codeVerifier: body.code_verifier ?? "",
            },
          );
          const tokens = await this.clients.issueAccessToken(
            this.options.realm,
            { ...grant, clientId: body.client_id ?? "" },
          );
          // ⚠️ Here rather than in the service, so the device-code grant
          // below gets it too - and every successful grant, which is what
          // makes `oauth_clients.lastUsedAt` mean anything. It was NULL on
          // every production row because nothing wrote it.
          await this.clients.markClientUsed(body.client_id ?? "");
          const response: Record<string, unknown> = {
            access_token: tokens.access_token,
            token_type: "Bearer",
            expires_in: tokens.expires_in,
            refresh_token: tokens.refresh_token,
            scope: grant.scopes.join(" "),
          };
          if (grant.scopes.includes("openid")) {
            response.id_token = await this.clients.issueIdToken(
              this.options.realm,
              {
                userId: grant.userId,
                clientId: body.client_id ?? "",
                issuer: this.baseUrl(url),
                nonce: grant.nonce,
              },
            );
          }
          reply.body = JSON.stringify(response);
          return;
        }

        if (
          body.grant_type === "urn:ietf:params:oauth:grant-type:device_code"
        ) {
          const result = await this.deviceCodes.poll(body.device_code ?? "");
          if (result.status !== "approved") {
            // RFC 8628 §3.5 names each of these, and a device is expected to
            // act differently on each: keep waiting, back off, give up, or
            // report a refusal. Collapsing them into one error would make a
            // correct client impossible to write.
            const errors = {
              pending: "authorization_pending",
              slow_down: "slow_down",
              denied: "access_denied",
              expired: "expired_token",
            } as const;
            reply.status = 400;
            reply.body = JSON.stringify({ error: errors[result.status] });
            return;
          }
          const tokens = await this.clients.issueAccessToken(
            this.options.realm,
            {
              userId: result.userId,
              scopes: result.scopes,
              resource: result.resource,
              clientId: body.client_id,
            },
          );
          await this.clients.markClientUsed(body.client_id ?? "");
          reply.body = JSON.stringify({
            access_token: tokens.access_token,
            token_type: "Bearer",
            expires_in: tokens.expires_in,
            refresh_token: tokens.refresh_token,
            scope: result.scopes.join(" "),
          });
          return;
        }

        if (body.grant_type === "refresh_token") {
          // Authenticate the client BEFORE spending the refresh token — the
          // same checks the authorization_code branch runs. Without them any
          // refresh-token holder could name any client_id, and that id became
          // the id_token `aud` unvalidated: a relying party that forwards
          // id_tokens as its Bearer would accept a token minted for it out of
          // a session belonging to an entirely different client.
          const client = await this.clients.findByClientId(
            body.client_id ?? "",
          );
          if (!client || client.revokedAt) {
            reply.status = 400;
            reply.body = JSON.stringify({ error: "invalid_client" });
            return;
          }
          if (client.type === "confidential") {
            const ok = await this.clients.verifySecret(
              client.clientId,
              body.client_secret ?? "",
            );
            if (!ok) {
              reply.status = 401;
              reply.body = JSON.stringify({ error: "invalid_client" });
              return;
            }
          }

          const tokens = await this.clients.refreshAccessToken(
            this.options.realm,
            body.refresh_token ?? "",
          );

          // Bind the refresh to the client the session was issued to. A
          // session with no recorded client (an ordinary password login) is
          // not an OAuth grant and cannot be refreshed here at all.
          if (tokens.clientId !== client.clientId) {
            reply.status = 400;
            reply.body = JSON.stringify({ error: "invalid_grant" });
            return;
          }

          // The refresh grant stamps it too, which is what makes the
          // column useful: a live MCP client refreshes every fifteen
          // minutes, so `lastUsedAt` tracks the app rather than only its
          // first authorization.
          await this.clients.markClientUsed(client.clientId);
          const response: Record<string, unknown> = {
            access_token: tokens.access_token,
            token_type: "Bearer",
            expires_in: tokens.expires_in,
            refresh_token: tokens.refresh_token,
          };
          // Re-mint an OIDC `id_token` so id_token-based relying parties (e.g. a
          // stateless OIDC RP that forwards the id_token as the request Bearer)
          // actually renew their identity on refresh — without it the RP keeps
          // forwarding the now-expired id_token and every call 401s. Per OIDC
          // Core §12.2 the refreshed id_token carries no `nonce`; `sub` is
          // unchanged.
          //
          // `aud` is the AUTHENTICATED client, not the raw `body.client_id` —
          // the two are equal by the check above, and naming the validated one
          // keeps them from drifting apart again.
          response.id_token = await this.clients.issueIdToken(
            this.options.realm,
            {
              userId: tokens.userId,
              clientId: client.clientId,
              issuer: this.baseUrl(url),
            },
          );
          reply.body = JSON.stringify(response);
          return;
        }

        reply.status = 400;
        reply.body = JSON.stringify({ error: "unsupported_grant_type" });
      } catch (e) {
        this.log.warn("OAuth token exchange failed", e);
        reply.status = 400;
        reply.body = JSON.stringify({ error: "invalid_grant" });
      }
    },
  });
}
