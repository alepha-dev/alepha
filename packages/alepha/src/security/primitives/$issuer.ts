import {
  $inject,
  Alepha,
  AlephaError,
  createPrimitive,
  KIND,
  Primitive,
} from "alepha";
import {
  DateTimeProvider,
  type Duration,
  type DurationLike,
} from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { ServerRequest } from "alepha/server";
import type { JSONWebKeySet, JWTPayload } from "jose";
import { currentTenantAtom } from "../atoms/currentTenantAtom.ts";
import { SecurityError } from "../errors/SecurityError.ts";
import type { IssuerResolver } from "../interfaces/IssuerResolver.ts";
import { JwtProvider, type SigningConfig } from "../providers/JwtProvider.ts";
import { SecurityProvider } from "../providers/SecurityProvider.ts";
import type { Role } from "../schemas/roleSchema.ts";
import type { UserAccount } from "../schemas/userAccountInfoSchema.ts";

/**
 * Create a new issuer.
 *
 * An issuer is responsible for creating and verifying JWT tokens.
 * It can be internal (with a secret) or external (with a JWKS).
 */
export const $issuer = (options: IssuerPrimitiveOptions): IssuerPrimitive => {
  return createPrimitive(IssuerPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export type IssuerPrimitiveOptions = {
  /**
   * Define the issuer name.
   * If not provided, it will use the property key.
   */
  name?: string;

  /**
   * Short description about the issuer.
   */
  description?: string;

  /**
   * All roles available in the issuer. Role is a string (role name) or a Role object (embedded role).
   */
  roles?: Array<string | Role>;

  /**
   * Issuer settings.
   */
  settings?: IssuerSettings;

  /**
   * Parse the JWT payload to create a user account info.
   */
  profile?: (jwtPayload: Record<string, any>) => UserAccount;

  /**
   * Custom resolvers (in addition to default JWT resolver).
   */
  resolvers?: IssuerResolver[];

  /**
   * Asymmetric signing config. When set, this issuer's tokens are signed with
   * the given alg + kid and its public keys are published via JWKS. When
   * omitted, the HS256 `secret` path is used (default, backward compatible).
   */
  signing?: SigningConfig;
} & (IssuerInternal | IssuerExternal);

export interface IssuerSettings {
  accessToken?: {
    /**
     * Lifetime of the access token.
     * @default 15 minutes
     */
    expiration?: DurationLike;
  };

  refreshToken?: {
    /**
     * Lifetime of the refresh token.
     * @default 30 days
     */
    expiration?: DurationLike;

    /**
     * Idle invalidation is enforced by session-backed realms via
     * `realmAuthSettings.refreshToken.expirationIdle` (in `alepha/api/users`).
     * Token-only refresh (no `onRefreshSession`) does not support idle
     * invalidation — it has no stateful row to track `lastUsedAt`.
     */
  };

  onCreateSession?: (
    user: UserAccount,
    config: {
      expiresIn: number;
      /**
       * OAuth client id, when the session is being created for an OAuth
       * 2.1 authorization-code grant. Lets the session store record which
       * MCP client / app the session belongs to.
       */
      clientId?: string;
    },
  ) => Promise<{
    refreshToken: string;
    sessionId?: string;
  }>;

  /**
   * Exchange a refresh token for the CURRENT user, re-read from your store.
   *
   * Strongly recommended. Without it the realm falls back to token-only
   * refresh, which rebuilds the user from the *expired* access token and
   * therefore re-issues whatever roles that token carried: a revoked or
   * demoted user keeps their old privileges until the refresh token itself
   * expires (30 days by default). Token-only mode also cannot support idle
   * invalidation, since there is no row to track `lastUsedAt` on.
   *
   * Provide this whenever roles can change during a session — i.e. almost
   * always. `alepha/api/users` wires it for you via `$realm`.
   */
  onRefreshSession?: (refreshToken: string) => Promise<{
    user: UserAccount;
    expiresIn: number;
    sessionId?: string;
  }>;

  onDeleteSession?: (refreshToken: string) => Promise<void>;
}

export type IssuerInternal = {
  /**
   * Internal secret to sign JWT tokens and verify them.
   */
  secret: string;
};

export interface IssuerExternal {
  /**
   * URL to the JWKS (JSON Web Key Set) to verify JWT tokens from external providers.
   */
  jwks: (() => string) | JSONWebKeySet;
}

// ---------------------------------------------------------------------------------------------------------------------

export class IssuerPrimitive extends Primitive<IssuerPrimitiveOptions> {
  protected readonly alepha = $inject(Alepha);
  protected readonly securityProvider = $inject(SecurityProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly jwt = $inject(JwtProvider);
  protected readonly log = $logger();

  public get name(): string {
    return this.options.name || this.config.propertyKey;
  }

  public get accessTokenExpiration(): Duration {
    return this.dateTimeProvider.duration(
      this.options.settings?.accessToken?.expiration ?? [15, "minutes"],
    );
  }

  public get refreshTokenExpiration(): Duration {
    return this.dateTimeProvider.duration(
      this.options.settings?.refreshToken?.expiration ?? [30, "days"],
    );
  }

  protected onInit() {
    const roles =
      this.options.roles?.map((it) => {
        if (typeof it === "string") {
          const role = this.getRoles().find((role) => role.name === it);
          if (!role) {
            throw new SecurityError(`Role '${it}' not found`);
          }
          return role;
        }

        return it;
      }) ?? [];

    this.securityProvider.createRealm({
      name: this.name,
      profile: this.options.profile,
      secret: "jwks" in this.options ? this.options.jwks : this.options.secret,
      signing: this.options.signing,
      roles,
      resolvers: [],
    });

    // Register custom resolvers first (they usually have lower priority)
    for (const resolver of this.options.resolvers ?? []) {
      this.registerResolver(resolver);
    }

    // Register default JWT resolver (priority 100)
    this.registerResolver(this.createJwtResolver());
  }

  /**
   * Creates the default JWT resolver.
   */
  protected createJwtResolver(): IssuerResolver {
    return {
      priority: 100,
      onRequest: async (req: ServerRequest) => {
        const auth = req.headers.authorization;
        if (!auth?.startsWith("Bearer ")) {
          return null;
        }

        const token = auth.slice(7);

        // Check if it looks like a JWT (has dots)
        if (!token.includes(".")) {
          return null;
        }

        // Parse and validate JWT
        const { result } = await this.jwt.parse(token, this.name);

        // Only an access token authenticates. Authorization codes, refresh
        // tokens and id_tokens are signed with this same key and would
        // otherwise pass straight through.
        if (!this.jwt.isAccessToken(this.name, result.protectedHeader)) {
          return null;
        }

        // Anti-replay: a token minted on tenant A must not authenticate on
        // tenant B. This is the primary auth path for `$realm`-based apps —
        // skipping the check here would make it dead code.
        if (!this.securityProvider.matchesTenantClaim(result.payload)) {
          return null;
        }

        // Extract user info from JWT payload
        return this.securityProvider.createUserFromPayload(
          result.payload,
          this.name,
        );
      },
    };
  }

  /**
   * Register a resolver to this issuer.
   * Resolvers are sorted by priority (lower = first).
   */
  public registerResolver(resolver: IssuerResolver): void {
    this.securityProvider.registerResolver(resolver, this.name);
  }

  /**
   * Get all roles in the issuer.
   */
  public getRoles(): Role[] {
    return this.securityProvider.getRoles(this.name);
  }

  /**
   * Set all roles in the issuer.
   */
  public async setRoles(roles: Role[]): Promise<void> {
    await this.securityProvider.updateRealm(this.name, roles);
  }

  /**
   * Get a role by name, throws an error if not found.
   */
  public getRoleByName(name: string): Role {
    const role = this.getRoles().find((it) => it.name === name);
    if (!role) {
      throw new SecurityError(`Role '${name}' not found`);
    }
    return role;
  }

  public async parseToken(token: string): Promise<JWTPayload> {
    const { result } = await this.jwt.parse(token, this.name);
    return result.payload;
  }

  /**
   * Create a token for the subject.
   */
  public async createToken(
    user: UserAccount,
    refreshToken?: {
      sid?: string;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    },
    context?: {
      /**
       * OAuth client id to tag a freshly created session with. Only used
       * on the `onCreateSession` path (no `refreshToken` passed).
       */
      clientId?: string;
    },
  ): Promise<AccessTokenResponse> {
    let sid: string | undefined = refreshToken?.sid;
    let refresh_token: string | undefined = refreshToken?.refresh_token;
    let refresh_token_expires_in: number | undefined =
      refreshToken?.refresh_token_expires_in;

    const iat = this.dateTimeProvider.now().unix();
    const exp = iat + this.accessTokenExpiration.asSeconds();

    if (!refreshToken) {
      const create = this.options.settings?.onCreateSession;
      if (create) {
        // -----------------------------------------------------------------------------------------------------------------
        // managed by the application
        const expiresIn = this.refreshTokenExpiration.asSeconds();
        const { refreshToken, sessionId } = await create(user, {
          expiresIn,
          clientId: context?.clientId,
        });

        refresh_token = refreshToken;
        refresh_token_expires_in = expiresIn;
        sid = sessionId;
      } else {
        // -----------------------------------------------------------------------------------------------------------------
        // token based

        const payload = {
          sub: user.id,
          exp: iat + this.refreshTokenExpiration.asSeconds(),
          iat,
          aud: this.name,
        };

        this.log.trace("Creating refresh token", payload);

        sid = crypto.randomUUID();
        refresh_token_expires_in = this.refreshTokenExpiration.asSeconds();
        refresh_token = await this.jwt.create(payload, this.name, {
          header: {
            typ: "refresh",
          },
        });
      }
    }

    this.log.trace("Creating access token", {
      sub: user.id,
      exp,
      iat,
      aud: this.name,
    });

    // Bind the token to the tenant the request is acting in. The default JWT
    // resolver compares this claim against `currentTenantAtom` on every
    // request, so a token minted on `b14.club.alepha.dev` is rejected on
    // `viska.club.alepha.dev` even when the user belongs to both.
    const tenant = this.alepha.store.get(currentTenantAtom)?.id;

    // Resilient display name: compose from first/last when the caller didn't
    // provide one (credentials users register with first+last but no `name`),
    // and carry the OIDC given/family claims so consumers can re-derive it —
    // otherwise such users surface as "Anonymous User".
    const composedName =
      user.name ??
      ([user.firstName, user.lastName]
        .filter((s): s is string => !!s?.trim())
        .join(" ")
        .trim() ||
        undefined);

    const access_token = await this.jwt.create(
      {
        // jwt
        sub: user.id,
        exp,
        iat,
        aud: this.name,
        sid, // session id, if available
        // oidc
        name: composedName,
        given_name: user.firstName,
        family_name: user.lastName,
        email: user.email,
        preferred_username: user.username,
        picture: user.picture,
        // our claims
        organization: user.organization,
        roles: user.roles,
        tenant,
      },
      this.name,
      // Marks this JWT as the only kind that may be presented as a Bearer.
      { header: { typ: this.jwt.accessTokenTyp } },
    );

    const response: AccessTokenResponse = {
      access_token,
      token_type: "Bearer",
      expires_in: this.accessTokenExpiration.asSeconds(),
      issued_at: iat,
      refresh_token,
      refresh_token_expires_in,
    };

    return response;
  }

  public async refreshToken(
    refreshToken: string,
    accessToken?: string,
  ): Promise<{
    tokens: AccessTokenResponse;
    user: UserAccount;
  }> {
    // -----------------------------------------------------------------------------------------------------------------
    // session based

    if (this.options.settings?.onRefreshSession) {
      // get user and expiration from the session
      const { user, expiresIn, sessionId } =
        await this.options.settings.onRefreshSession(refreshToken);

      // then, create a new access token
      const tokens = await this.createToken(user, {
        sid: sessionId,
        refresh_token: refreshToken,
        refresh_token_expires_in: expiresIn,
      });

      return { user, tokens };
    }

    // -----------------------------------------------------------------------------------------------------------------
    // token based

    if (!accessToken) {
      throw new AlephaError("An access token is required for refreshing");
    }

    // Extract user from an expired token.
    // WARNING: Roles from the expired token are reused without re-validation.
    // If roles were revoked, the new access token will still contain old roles
    // until the refresh token expires. Use session-based refresh (onRefreshSession)
    // to re-fetch current roles from the database on each refresh.
    const user = await this.securityProvider.createUserFromToken(accessToken, {
      realm: this.name,
      verify: {
        currentDate: new Date(0), // don't verify expiration, it's expected to be expired...
      },
    });

    // check if the refresh token is valid + match access token user
    const {
      result: { payload },
    } = await this.jwt.parse(refreshToken, this.name, {
      typ: "refresh",
      audience: this.name,
      subject: user.id,
    });

    const iat = this.dateTimeProvider.now().unix();
    const expiresIn = payload.exp
      ? payload.exp - iat
      : this.refreshTokenExpiration.asSeconds();

    return {
      user,
      tokens: await this.createToken(user, {
        sid: payload.sid,
        refresh_token: refreshToken,
        refresh_token_expires_in: expiresIn,
      }),
    };
  }
}

$issuer[KIND] = IssuerPrimitive;

// ---------------------------------------------------------------------------------------------------------------------

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  issued_at: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}
