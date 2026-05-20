import { $atom, $inject, $state, t } from "alepha";
import { $logger } from "alepha/logger";
import { $route } from "alepha/server";
import { renderConsentPage } from "../helpers/consentPage.ts";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
} from "../helpers/oauthMetadata.ts";
import { authorizeDecisionBodySchema } from "../schemas/authorizeDecisionBodySchema.ts";
import { authorizeQuerySchema } from "../schemas/authorizeQuerySchema.ts";
import { registerClientBodySchema } from "../schemas/registerClientBodySchema.ts";
import { tokenRequestBodySchema } from "../schemas/tokenRequestBodySchema.ts";
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
  schema: t.object({
    realm: t.text({ default: "users" }),
    resource: t.text({ default: "/mcp" }),
    loginPath: t.text({ default: "/login" }),
  }),
  default: { realm: "users", resource: "/mcp", loginPath: "/login" },
});

/**
 * OAuth 2.1 authorization server endpoints: discovery metadata and
 * RFC 7591 dynamic client registration. Authorize/token routes are added
 * separately.
 */
export class OAuthController {
  protected readonly log = $logger();
  protected readonly options = $state(oauthOptions);
  protected readonly clients = $inject(OAuthClientService);

  /**
   * Absolute origin of the current request, e.g. https://app.com.
   */
  protected baseUrl(url: URL): string {
    return `${url.protocol}//${url.host}`;
  }

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

  register = $route({
    method: "POST",
    path: "/oauth/register",
    schema: { body: registerClientBodySchema },
    handler: async ({ body, reply }) => {
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
      if (!user) {
        const returnTo = encodeURIComponent(url.pathname + url.search);
        reply.redirect(
          `${this.options.loginPath}?redirect_uri=${returnTo}`,
          302,
        );
        return;
      }
      reply.headers["content-type"] = "text/html; charset=utf-8";
      reply.body = renderConsentPage({
        clientName: client.clientName,
        userName: user.name ?? user.email ?? "your account",
        scopes: query.scope ? query.scope.split(" ") : client.scopes,
        hidden: {
          response_type: query.response_type,
          client_id: query.client_id,
          redirect_uri: query.redirect_uri,
          code_challenge: query.code_challenge,
          code_challenge_method: query.code_challenge_method,
          scope: query.scope ?? "",
          state: query.state ?? "",
          resource: query.resource ?? "",
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
          scopes: body.scope ? body.scope.split(" ") : client.scopes,
          resource: body.resource || undefined,
        },
      );
      redirect.searchParams.set("code", code);
      if (body.state) redirect.searchParams.set("state", body.state);
      reply.redirect(redirect.toString(), 302);
    },
  });

  /**
   * POST /oauth/token — authorization_code grant. Verifies PKCE, then mints
   * an access token via the realm issuer.
   */
  token = $route({
    method: "POST",
    path: "/oauth/token",
    schema: { body: tokenRequestBodySchema },
    use: [],
    handler: async ({ body, reply }) => {
      if (body.grant_type !== "authorization_code") {
        reply.status = 400;
        reply.headers["content-type"] = "application/json";
        reply.body = JSON.stringify({ error: "unsupported_grant_type" });
        return;
      }
      const code = body.code ?? "";
      const clientId = body.client_id ?? "";
      const redirectUri = body.redirect_uri ?? "";
      const codeVerifier = body.code_verifier ?? "";
      try {
        const grant = await this.clients.consumeAuthorizationCode(
          this.options.realm,
          code,
          { clientId, redirectUri, codeVerifier },
        );
        const tokens = await this.clients.issueAccessToken(this.options.realm, {
          ...grant,
          clientId,
        });
        reply.headers["content-type"] = "application/json";
        reply.body = JSON.stringify({
          access_token: tokens.access_token,
          token_type: "Bearer",
          expires_in: tokens.expires_in,
          refresh_token: tokens.refresh_token,
          scope: grant.scopes.join(" "),
        });
      } catch (e) {
        this.log.warn("OAuth token exchange failed", e);
        reply.status = 400;
        reply.headers["content-type"] = "application/json";
        reply.body = JSON.stringify({ error: "invalid_grant" });
      }
    },
  });
}
