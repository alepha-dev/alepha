import {
  $inject,
  AlephaError,
  type Async,
  createPrimitive,
  KIND,
  Primitive,
} from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  type AccessTokenResponse,
  type IssuerPrimitive,
  SecurityError,
  SecurityProvider,
  type UserAccount,
} from "alepha/security";
import {
  allowInsecureRequests,
  Configuration,
  discovery,
  refreshTokenGrant,
} from "openid-client";
import type { OAuth2Profile } from "../providers/ServerAuthProvider.ts";
import type { Tokens } from "../schemas/tokensSchema.ts";

/**
 * Creates an authentication provider primitive for handling user login flows.
 *
 * Supports multiple authentication strategies: credentials (username/password), OAuth2,
 * and OIDC (OpenID Connect). Handles token management, user profile retrieval, and
 * integration with both external identity providers (Auth0, Keycloak) and internal realms.
 *
 * **Authentication Types**: Credentials, OAuth2 (Google, GitHub), OIDC, External providers
 *
 * @example
 * ```ts
 * class AuthProviders {
 *   // Internal credentials-based auth
 *   credentials = $auth({
 *     realm: this.userRealm,
 *     credentials: {
 *       account: async ({ username, password }) => {
 *         return await this.validateUser(username, password);
 *       }
 *     }
 *   });
 *
 *   // External OIDC provider
 *   keycloak = $auth({
 *     oidc: {
 *       issuer: "https://auth.example.com",
 *       clientId: "my-app",
 *       clientSecret: "secret",
 *       redirectUri: "/auth/callback"
 *     }
 *   });
 * }
 * ```
 */
export const $auth = (options: AuthPrimitiveOptions): AuthPrimitive => {
  return createPrimitive(AuthPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export type AuthPrimitiveOptions = {
  /**
   * Name of the identity provider.
   * If not provided, it will be derived from the property key.
   */
  name?: string;

  /**
   * If true, auth provider will be skipped.
   */
  disabled?: boolean;
} & (AuthExternal | AuthInternal);

/**
 * When you let an external service handle authentication. (e.g. Keycloak, Auth0, etc.)
 */
export type AuthExternal = {
  /**
   * Only OIDC is supported for external authentication.
   */
  oidc: OidcOptions;

  /**
   * For anonymous access, this will expect a service account access token.
   *
   * ```ts
   * class App {
   *   anonymous = $serviceAccount(...);
   *   auth = $auth({
   *     // ... config ...
   *     fallback: this.anonymous,
   *   })
   * }
   * ```
   */
  fallback?: () => Async<AccessToken>;
};

/**
 * When using your own authentication system, e.g. using a database to store user accounts.
 * This is usually used with a custom login form.
 *
 * This relies on the `issuer`, which is used to create/verify the access token.
 */
export type AuthInternal = {
  issuer: IssuerPrimitive;
} & (
  | {
      /**
       * The common username/password authentication.
       *
       * - It uses the OAuth2 Client Credentials flow to obtain an access token.
       *
       * This is usually used with a custom login form on your website or mobile app.
       */
      credentials: CredentialsOptions;
    }
  | {
      /**
       * OAuth2 authentication. Delegates authentication to an OAuth2 provider. (e.g. Google, GitHub, etc.)
       *
       * - It uses the OAuth2 Authorization Code flow to obtain an access token and user information.
       *
       * This is usually used with a login button that redirects to the OAuth2 provider.
       */
      oauth: OAuth2Options;
    }
  | {
      /**
       * Like OAuth2, but uses OIDC (OpenID Connect) for authentication and user information retrieval.
       * OIDC is an identity layer on top of OAuth2, providing user authentication and profile information.
       *
       * - It uses the OAuth2 Authorization Code flow to obtain an access token and user information.
       * - PCKE (Proof Key for Code Exchange) is recommended for security.
       *
       * This is usually used with a login button that redirects to the OIDC provider.
       */
      oidc: OidcOptions;
    }
);

export type CredentialsOptions = {
  account: CredentialsFn;
};

export type CredentialsFn = (
  credentials: Credentials,
) => Async<UserAccount | undefined>;

export interface Credentials {
  username: string;
  password: string;
}

export interface OidcOptions {
  /**
   * URL of the OIDC issuer.
   */
  issuer: string;

  /**
   * Client ID for the OIDC client.
   */
  clientId: string;

  /**
   * Client secret for the OIDC client.
   * Optional if PKCE (Proof Key for Code Exchange) is used.
   */
  clientSecret?: string;

  /**
   * Redirect URI for the OIDC client.
   * This is where the user will be redirected after authentication.
   */
  redirectUri?: string;

  /**
   * For external auth providers only.
   * Take the ID token instead of the access token for validation.
   */
  useIdToken?: boolean;

  /**
   * URI to redirect the user after logout.
   */
  logoutUri?: string;

  /**
   * Optional scope for the OIDC client.
   * @default "openid profile email".
   */
  scope?: string;

  account?: LinkAccountFn;

  /**
   * OAuth2 response mode.
   * Apple requires "form_post" which sends the authorization code via POST body
   * instead of URL query parameters.
   */
  responseMode?: "query" | "fragment" | "form_post";

  /**
   * Additional parameters to include in the authorization URL.
   * Useful for provider-specific parameters.
   */
  authorizationParameters?: Record<string, string>;
}

export interface LinkAccountOptions {
  access_token: string;
  user: OAuth2Profile;
  id_token?: string;
  expires_in?: number;
  scope?: string;
}

export type LinkAccountFn = (tokens: LinkAccountOptions) => Async<UserAccount>;

export interface OAuth2Options {
  /**
   * URL of the OAuth2 authorization endpoint.
   */
  clientId: string;

  /**
   * Client secret for the OAuth2 client.
   */
  clientSecret: string;

  /**
   * URL of the OAuth2 authorization endpoint.
   */
  authorization: string;

  /**
   * URL of the OAuth2 token endpoint.
   */
  token: string;

  /**
   * Function to retrieve user profile information from the OAuth2 tokens.
   */
  userinfo: (tokens: Tokens) => Async<OAuth2Profile>;

  account?: LinkAccountFn;

  /**
   * URL of the OAuth2 authorization endpoint.
   */
  redirectUri?: string;

  /**
   * URL of the OAuth2 authorization endpoint.
   */
  scope?: string;
}

// ---------------------------------------------------------------------------------------------------------------------

export class AuthPrimitive extends Primitive<AuthPrimitiveOptions> {
  protected readonly securityProvider = $inject(SecurityProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);

  protected oauthConfig?: Configuration;
  protected oauthInitializer?: () => Promise<Configuration>;

  public get oauth(): Configuration | undefined {
    return this.oauthConfig;
  }

  /**
   * Get the OAuth2/OIDC configuration, initializing lazily if needed (serverless mode).
   */
  public async getOAuth(): Promise<Configuration | undefined> {
    if (this.oauthConfig) {
      return this.oauthConfig;
    }

    if (this.oauthInitializer) {
      this.oauthConfig = await this.oauthInitializer();
      this.oauthInitializer = undefined;
      return this.oauthConfig;
    }

    return undefined;
  }

  public get name() {
    return this.options.name ?? this.config.propertyKey;
  }

  public get issuer(): IssuerPrimitive | undefined {
    if ("issuer" in this.options) {
      return this.options.issuer;
    }
    return undefined;
  }

  public get jwks_uri(): string {
    const jwks = this.oauth?.serverMetadata().jwks_uri;
    if (!jwks) {
      throw new AlephaError("No JWKS URI available for the auth provider");
    }
    return jwks;
  }

  public get scope(): string | undefined {
    if ("oauth" in this.options) {
      return this.options.oauth.scope;
    }
    if ("oidc" in this.options) {
      return this.options.oidc.scope || "openid profile email";
    }
    throw new AlephaError(
      "No OAuth2 or OIDC configuration available for the auth provider",
    );
  }

  public get redirect_uri() {
    if ("oauth" in this.options) {
      return this.options.oauth.redirectUri;
    }
    if ("oidc" in this.options) {
      return this.options.oidc.redirectUri;
    }
    throw new AlephaError(
      "No OAuth2 or OIDC configuration available for the auth provider",
    );
  }

  /**
   * Refreshes the access token using the refresh token.
   * Can be used on oauth2, oidc or credentials auth providers.
   */
  public async refresh(
    refreshToken: string,
    accessToken?: string,
  ): Promise<AccessTokenResponse> {
    if ("issuer" in this.options) {
      return this.options.issuer
        .refreshToken(refreshToken, accessToken)
        .then((it) => it.tokens)
        .catch((error) => {
          throw new SecurityError(
            "Failed to refresh access token using the refresh token (issuer)",
            {
              cause: error,
            },
          );
        });
    }

    const oauth = await this.getOAuth();
    if (oauth) {
      try {
        return {
          ...(await refreshTokenGrant(oauth, refreshToken)),
          issued_at: this.dateTimeProvider.now().unix(),
        };
      } catch (error) {
        throw new SecurityError(
          "Failed to refresh access token using the refresh token (oauth2)",
          {
            cause: error,
          },
        );
      }
    }

    throw new AlephaError(
      "No issuer or OAuth2 configuration available for refreshing the access token",
    );
  }

  /**
   * Extracts user information from the access token.
   * This is used to create a user account from the access token.
   *
   * `externalProfile` carries extra profile fields that cannot be derived from the
   * ID token or userinfo endpoint — e.g. Apple's `user` form field that is only
   * delivered once, on first authorization. ID token / userinfo fields take
   * precedence; externalProfile only fills gaps.
   */
  public async user(
    tokens: Tokens,
    externalProfile?: Record<string, unknown>,
  ): Promise<UserAccount> {
    try {
      if ("oauth" in this.options) {
        const profile = {
          ...externalProfile,
          ...(await this.options.oauth.userinfo(tokens)),
        } as OAuth2Profile;

        if (this.options.oauth.account) {
          return this.options.oauth.account({
            ...tokens,
            user: profile,
          });
        }

        return this.securityProvider.createUserFromPayload(profile);
      }

      if ("oidc" in this.options) {
        const payload = {
          ...externalProfile,
          ...this.getUserFromIdToken(tokens.id_token || ""),
        } as OAuth2Profile;

        if (this.options.oidc.account) {
          return this.options.oidc.account({
            ...tokens,
            user: payload,
          });
        }

        return this.securityProvider.createUserFromPayload(payload);
      }
    } catch (error) {
      throw new SecurityError(
        "Failed to extract user from identity provider tokens",
        {
          cause: error,
        },
      );
    }

    throw new AlephaError(
      "This authentication does not support user extraction from tokens",
    );
  }

  // Security note: No JWT signature verification here is intentional and safe.
  // The id_token is received via authorizationCodeGrant() which fetches it over a
  // back-channel TLS connection directly from the IdP's token endpoint. TLS authenticates
  // the channel. openid-client/oauth4webapi validates claims (issuer, audience, nonce,
  // expiry) during the grant. Per OIDC spec, cryptographic signature verification is
  // not required for back-channel token responses — only for implicit/hybrid flows.
  // See: openid-client index.d.ts enableNonRepudiationChecks() docs.
  protected getUserFromIdToken(idToken: string): OAuth2Profile {
    try {
      return JSON.parse(
        Buffer.from(idToken.split(".")[1], "base64").toString("utf8"),
      ) as OAuth2Profile;
    } catch (error) {
      throw new AlephaError("Failed to parse ID Token payload", {
        cause: error,
      });
    }
  }

  public async prepare() {
    if ("oidc" in this.options) {
      const { oidc } = this.options;

      const discoverOidc = async () => {
        const execute: Array<(config: Configuration) => void> = [];
        // Only relax TLS for local/dev issuers. Applying it unconditionally
        // disabled HTTPS enforcement on the OIDC discovery + token exchange
        // for every deployment, including production.
        const issuerUrl = new URL(oidc.issuer);
        const isLocalIssuer =
          issuerUrl.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(
            issuerUrl.hostname,
          );
        if (isLocalIssuer || !this.alepha.isProduction()) {
          execute.push(allowInsecureRequests);
        }

        return discovery(
          new URL(oidc.issuer),
          oidc.clientId,
          {
            client_secret: oidc.clientSecret,
          },
          undefined,
          {
            execute,
          },
        );
      };

      // OIDC discovery is always lazy (resolved on first auth-flow use via the
      // `oauthConfiguration` getter). It must never be a hard boot dependency:
      // a relying party has to boot even when its IdP is briefly unreachable
      // (cross-service start order, deploys), and deferring also avoids the
      // serverless cold-start fetch.
      this.oauthInitializer = discoverOidc;
    }

    if ("oauth" in this.options) {
      const { oauth } = this.options;

      this.oauthConfig = new Configuration(
        {
          authorization_endpoint: oauth.authorization,
          token_endpoint: oauth.token,
          issuer: oauth.authorization, // use authorization URL as a pseudo-issuer?
          // we don't need all of these endpoints
          jwks_uri: undefined,
          end_session_endpoint: undefined,
        },
        oauth.clientId,
        {
          client_secret: oauth.clientSecret,
        },
      );
    }
  }
}

$auth[KIND] = AuthPrimitive;

// ---------------------------------------------------------------------------------------------------------------------

export type AccessToken = string | { token: () => Async<string> };

export interface WithLinkFn {
  link?: (name: string) => (opts: LinkAccountOptions) => Async<UserAccount>;
}

export interface WithLoginFn {
  login?: (
    provider: string,
  ) => (creds: Credentials) => Async<UserAccount | undefined>;
}
