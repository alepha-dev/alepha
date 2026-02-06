import { $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import type { UserAccountToken } from "alepha/security";
import { $route, BadRequestError } from "alepha/server";
import { oauth2TokenRequestSchema } from "../schemas/oauth2TokenRequestSchema.ts";
import { OAuth2Service } from "../services/OAuth2Service.ts";

/**
 * OAuth2 protocol endpoints.
 *
 * Implements authorization code + PKCE, client credentials, refresh token grants,
 * token introspection, revocation, and discovery metadata.
 */
export class OAuth2Controller {
  protected readonly oauth2Service = $inject(OAuth2Service);
  protected readonly log = $logger();

  // -------------------------------------------------------------------------
  // Authorization Endpoint
  // -------------------------------------------------------------------------

  /**
   * GET /oauth2/authorize — Authorization endpoint.
   * User must be authenticated via cookie. Validates the request,
   * checks consent, and either issues a code or redirects to consent page.
   */
  public readonly authorize = $route({
    path: "/oauth2/authorize",
    handler: async ({ url, reply, user }) => {
      const params = {
        response_type: url.searchParams.get("response_type") ?? undefined,
        client_id: url.searchParams.get("client_id") ?? undefined,
        redirect_uri: url.searchParams.get("redirect_uri") ?? undefined,
        scope: url.searchParams.get("scope") ?? undefined,
        state: url.searchParams.get("state") ?? undefined,
        code_challenge: url.searchParams.get("code_challenge") ?? undefined,
        code_challenge_method:
          url.searchParams.get("code_challenge_method") ?? undefined,
        resource: url.searchParams.get("resource") ?? undefined,
      };

      // Validate the authorization request
      let validated: Awaited<
        ReturnType<OAuth2Service["validateAuthorizationRequest"]>
      >;
      try {
        validated =
          await this.oauth2Service.validateAuthorizationRequest(params);
      } catch (e: any) {
        // If redirect_uri is known and valid, redirect with error
        if (params.redirect_uri && params.client_id) {
          try {
            const client = await this.oauth2Service.getClient(params.client_id);
            if (client.redirectUris.includes(params.redirect_uri)) {
              const errorUrl = new URL(params.redirect_uri);
              errorUrl.searchParams.set(
                "error",
                e.oauth2Error ?? "server_error",
              );
              if (e.oauth2ErrorDescription) {
                errorUrl.searchParams.set(
                  "error_description",
                  e.oauth2ErrorDescription,
                );
              }
              if (params.state) {
                errorUrl.searchParams.set("state", params.state);
              }
              reply.redirect(errorUrl.toString());
              return;
            }
          } catch {
            // fall through to error display
          }
        }

        // Cannot safely redirect — show error
        reply.setStatus(400).setBody({
          error: e.oauth2Error ?? "invalid_request",
          error_description:
            e.oauth2ErrorDescription ?? e.message ?? "Invalid request",
        });
        return;
      }

      // User must be logged in
      if (!user) {
        const returnUrl = `/oauth2/authorize?${url.searchParams.toString()}`;
        reply.redirect(`/auth/login?r=${encodeURIComponent(returnUrl)}`);
        return;
      }

      const authUser = user as UserAccountToken;

      // First-party clients skip consent
      if (validated.client.firstParty) {
        await this.issueCodeAndRedirect(authUser.id, validated, reply);
        return;
      }

      // Check existing consent
      const hasConsent = await this.oauth2Service.hasConsent(
        authUser.id,
        validated.client.clientId,
        validated.scopes,
      );

      if (hasConsent) {
        await this.issueCodeAndRedirect(authUser.id, validated, reply);
        return;
      }

      // Redirect to consent page
      const consentUrl = new URL("/oauth2/consent", url.origin);
      consentUrl.searchParams.set("client_id", validated.client.clientId);
      consentUrl.searchParams.set("redirect_uri", validated.redirectUri);
      consentUrl.searchParams.set("scope", validated.scopes.join(" "));
      consentUrl.searchParams.set("code_challenge", validated.codeChallenge);
      consentUrl.searchParams.set("code_challenge_method", "S256");
      if (validated.state) {
        consentUrl.searchParams.set("state", validated.state);
      }
      if (validated.resource) {
        consentUrl.searchParams.set("resource", validated.resource);
      }

      reply.redirect(consentUrl.toString());
    },
  });

  // -------------------------------------------------------------------------
  // Consent Endpoint
  // -------------------------------------------------------------------------

  /**
   * POST /oauth2/consent — Process user consent decision.
   */
  public readonly consent = $route({
    path: "/oauth2/consent",
    method: "POST",
    schema: {
      body: t.object({
        client_id: t.text(),
        redirect_uri: t.text(),
        scope: t.optional(t.text()),
        code_challenge: t.text(),
        code_challenge_method: t.optional(t.text()),
        state: t.optional(t.text()),
        resource: t.optional(t.text()),
        decision: t.enum(["allow", "deny"]),
      }),
    },
    handler: async ({ body, reply, user }) => {
      if (!user) {
        reply.setStatus(401).setBody({
          error: "login_required",
          error_description: "User must be logged in",
        });
        return;
      }

      const authUser = user as UserAccountToken;

      // Validate the request first to ensure redirect_uri is safe
      const validated = await this.oauth2Service.validateAuthorizationRequest({
        response_type: "code",
        client_id: body.client_id,
        redirect_uri: body.redirect_uri,
        scope: body.scope,
        code_challenge: body.code_challenge,
        code_challenge_method: body.code_challenge_method ?? "S256",
        state: body.state,
        resource: body.resource,
      });

      // If denied, redirect with error (redirect_uri is now validated)
      if (body.decision === "deny") {
        const errorUrl = new URL(validated.redirectUri);
        errorUrl.searchParams.set("error", "access_denied");
        errorUrl.searchParams.set(
          "error_description",
          "The user denied the authorization request",
        );
        if (validated.state) {
          errorUrl.searchParams.set("state", validated.state);
        }
        reply.redirect(errorUrl.toString());
        return;
      }

      // Save consent
      await this.oauth2Service.saveConsent(
        authUser.id,
        validated.client.clientId,
        validated.scopes,
      );

      // Issue code and redirect
      await this.issueCodeAndRedirect(authUser.id, validated, reply);
    },
  });

  // -------------------------------------------------------------------------
  // Token Endpoint
  // -------------------------------------------------------------------------

  /**
   * POST /oauth2/token — Token endpoint.
   * Supports authorization_code, client_credentials, and refresh_token grants.
   * Accepts application/x-www-form-urlencoded and application/json.
   */
  public readonly token = $route({
    path: "/oauth2/token",
    method: "POST",
    schema: {
      body: oauth2TokenRequestSchema,
    },
    handler: async ({ body, headers, reply }) => {
      // RFC 6749 Section 5.1: token responses must not be cached
      reply.headers["cache-control"] = "no-store";
      reply.headers["pragma"] = "no-cache";

      try {
        // Parse client credentials from Basic auth header or body
        const basicAuth = this.oauth2Service.parseBasicAuth(
          headers.authorization,
        );

        const clientId = basicAuth?.clientId ?? body.client_id;
        const clientSecret = basicAuth?.clientSecret ?? body.client_secret;

        if (!clientId) {
          this.tokenError(400, "invalid_request", "client_id is required");
        }

        switch (body.grant_type) {
          case "authorization_code":
            reply.setBody(
              await this.handleAuthorizationCodeGrant(
                clientId!,
                clientSecret,
                body,
              ),
            );
            return;

          case "client_credentials":
            reply.setBody(
              await this.handleClientCredentialsGrant(
                clientId!,
                clientSecret,
                body,
              ),
            );
            return;

          case "refresh_token":
            reply.setBody(
              await this.handleRefreshTokenGrant(clientId!, clientSecret, body),
            );
            return;

          default:
            this.tokenError(
              400,
              "unsupported_grant_type",
              `Grant type '${String(body.grant_type).slice(0, 50)}' is not supported`,
            );
        }
      } catch (e: any) {
        const status = e.statusCode ?? e.status ?? 400;
        if (status === 401) {
          reply.headers["www-authenticate"] = "Basic";
        }
        reply.setStatus(status).setBody({
          error: e.body?.error ?? e.oauth2Error ?? "server_error",
          error_description:
            e.body?.error_description ?? e.oauth2ErrorDescription ?? e.message,
        });
      }
    },
  });

  protected async handleAuthorizationCodeGrant(
    clientId: string,
    clientSecret: string | undefined,
    body: Record<string, any>,
  ) {
    if (!body.code) {
      this.tokenError(400, "invalid_request", "code is required");
    }
    if (!body.redirect_uri) {
      this.tokenError(400, "invalid_request", "redirect_uri is required");
    }
    if (!body.code_verifier) {
      this.tokenError(400, "invalid_request", "code_verifier is required");
    }

    try {
      const client = await this.oauth2Service.authenticateClient(
        clientId,
        clientSecret,
      );

      const tokens = await this.oauth2Service.exchangeCode({
        code: body.code,
        clientId: client.clientId,
        redirectUri: body.redirect_uri,
        codeVerifier: body.code_verifier,
        resource: body.resource,
      });

      return {
        access_token: tokens.access_token,
        token_type: tokens.token_type,
        expires_in: tokens.expires_in,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
      };
    } catch (e: any) {
      this.tokenError(
        400,
        e.oauth2Error ?? "invalid_grant",
        e.oauth2ErrorDescription ?? e.message,
      );
    }
  }

  protected async handleClientCredentialsGrant(
    clientId: string,
    clientSecret: string | undefined,
    body: Record<string, any>,
  ) {
    if (!clientSecret) {
      this.tokenError(
        401,
        "invalid_client",
        "Client authentication required for client_credentials grant",
      );
    }

    try {
      const client = await this.oauth2Service.authenticateClient(
        clientId,
        clientSecret,
      );

      const tokens = await this.oauth2Service.clientCredentialsGrant({
        client,
        scope: body.scope,
        resource: body.resource,
      });

      return {
        access_token: tokens.access_token,
        token_type: tokens.token_type,
        expires_in: tokens.expires_in,
        scope: tokens.scope,
      };
    } catch (e: any) {
      this.tokenError(
        e.oauth2Error === "invalid_client" ? 401 : 400,
        e.oauth2Error ?? "invalid_grant",
        e.oauth2ErrorDescription ?? e.message,
      );
    }
  }

  protected async handleRefreshTokenGrant(
    clientId: string,
    clientSecret: string | undefined,
    body: Record<string, any>,
  ) {
    if (!body.refresh_token) {
      this.tokenError(400, "invalid_request", "refresh_token is required");
    }

    try {
      const client = await this.oauth2Service.authenticateClient(
        clientId,
        clientSecret,
      );

      const tokens = await this.oauth2Service.refreshTokenGrant({
        client,
        refreshToken: body.refresh_token,
        scope: body.scope,
      });

      return {
        access_token: tokens.access_token,
        token_type: tokens.token_type,
        expires_in: tokens.expires_in,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
      };
    } catch (e: any) {
      this.tokenError(
        400,
        e.oauth2Error ?? "invalid_grant",
        e.oauth2ErrorDescription ?? e.message,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Revocation Endpoint
  // -------------------------------------------------------------------------

  /**
   * POST /oauth2/revoke — Token revocation (RFC 7009).
   * Always returns 200 (even for invalid tokens, per spec).
   */
  public readonly revoke = $route({
    path: "/oauth2/revoke",
    method: "POST",
    schema: {
      body: t.object({
        token: t.text({ size: "rich" }),
        token_type_hint: t.optional(t.text()),
      }),
    },
    handler: async ({ body, headers, reply }) => {
      // RFC 7009: if client credentials are provided, they must be valid
      const basicAuth = this.oauth2Service.parseBasicAuth(
        headers.authorization,
      );

      let clientId: string | undefined;

      if (basicAuth) {
        try {
          const client = await this.oauth2Service.authenticateClient(
            basicAuth.clientId,
            basicAuth.clientSecret,
          );
          clientId = client.clientId;
        } catch {
          reply.headers["www-authenticate"] = "Basic";
          reply.setStatus(401).setBody({
            error: "invalid_client",
            error_description: "Invalid client credentials",
          });
          return;
        }
      }

      await this.oauth2Service.revoke(body.token, clientId);
      reply.setBody({});
    },
  });

  // -------------------------------------------------------------------------
  // Introspection Endpoint
  // -------------------------------------------------------------------------

  /**
   * POST /oauth2/introspect — Token introspection (RFC 7662).
   */
  public readonly introspect = $route({
    path: "/oauth2/introspect",
    method: "POST",
    schema: {
      body: t.object({
        token: t.text({ size: "rich" }),
        token_type_hint: t.optional(t.text()),
      }),
    },
    handler: async ({ body, headers, reply }) => {
      // RFC 7662 Section 2.1: client authentication is required
      const basicAuth = this.oauth2Service.parseBasicAuth(
        headers.authorization,
      );

      if (!basicAuth) {
        reply.headers["www-authenticate"] = "Basic";
        reply.setStatus(401).setBody({
          error: "invalid_client",
          error_description: "Client authentication required",
        });
        return;
      }

      try {
        await this.oauth2Service.authenticateClient(
          basicAuth.clientId,
          basicAuth.clientSecret,
        );
      } catch {
        reply.setBody({ active: false });
        return;
      }

      reply.setBody(await this.oauth2Service.introspect(body.token));
    },
  });

  // -------------------------------------------------------------------------
  // Discovery Metadata
  // -------------------------------------------------------------------------

  /**
   * GET /.well-known/oauth-authorization-server — AS Metadata (RFC 8414).
   */
  public readonly asMetadata = $route({
    path: "/.well-known/oauth-authorization-server",
    handler: async ({ url, reply }) => {
      const baseUrl = `${url.protocol}//${url.host}`;
      reply.setBody(this.oauth2Service.getServerMetadata(baseUrl));
    },
  });

  /**
   * GET /.well-known/openid-configuration — OIDC discovery (alias).
   */
  public readonly oidcDiscovery = $route({
    path: "/.well-known/openid-configuration",
    handler: async ({ url, reply }) => {
      const baseUrl = `${url.protocol}//${url.host}`;
      reply.setBody(this.oauth2Service.getServerMetadata(baseUrl));
    },
  });

  /**
   * GET /.well-known/oauth-protected-resource — Protected Resource Metadata (RFC 9728).
   */
  public readonly protectedResourceMetadata = $route({
    path: "/.well-known/oauth-protected-resource",
    handler: async ({ url, reply }) => {
      const baseUrl = `${url.protocol}//${url.host}`;
      reply.setBody(this.oauth2Service.getProtectedResourceMetadata(baseUrl));
    },
  });

  /**
   * GET /.well-known/jwks.json — JWKS endpoint.
   * Returns empty keyset for HS256 (symmetric). Meaningful when RS256/ES256 is added.
   */
  public readonly jwks = $route({
    path: "/.well-known/jwks.json",
    handler: async ({ reply }) => {
      reply.setBody({ keys: [] });
    },
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  protected async issueCodeAndRedirect(
    userId: string,
    validated: Awaited<
      ReturnType<OAuth2Service["validateAuthorizationRequest"]>
    >,
    reply: any,
  ) {
    const code = await this.oauth2Service.createAuthorizationCode(
      userId,
      validated,
    );

    const redirectUrl = new URL(validated.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (validated.state) {
      redirectUrl.searchParams.set("state", validated.state);
    }

    reply.redirect(redirectUrl.toString());
  }

  protected tokenError(
    status: number,
    error: string,
    description?: string,
  ): never {
    const err = new BadRequestError(description ?? error);
    (err as any).statusCode = status;
    (err as any).body = {
      error,
      error_description: description,
    };
    throw err;
  }
}
