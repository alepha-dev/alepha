import { $context, AlephaError } from "alepha";
import { AlephaApiKeys, ApiKeyService } from "alepha/api/keys";
import {
  AlephaOAuth,
  OAuthClientService,
  oauthOptions,
} from "alepha/api/oauth";
import { $parameter, AlephaApiParameters } from "alepha/api/parameters";
import { AlephaApiVerification } from "alepha/api/verifications";
import { mcpStreamableHttpOptions } from "alepha/mcp";
import type { Repository } from "alepha/orm";
import {
  $issuer,
  $permission,
  type IssuerPrimitive,
  type IssuerPrimitiveOptions,
  type IssuerResolver,
  SecurityProvider,
  type SigningConfig,
} from "alepha/security";
import {
  $authApple,
  $authCredentials,
  $authFacebook,
  $authFranceConnect,
  $authGithub,
  $authGoogle,
  $authMicrosoft,
  type AuthPrimitive,
  type Credentials,
  type LinkAccountOptions,
  type WithLinkFn,
  type WithLoginFn,
} from "alepha/server/auth";
import {
  type RealmAuthSettings,
  realmAuthSettingsAtom,
} from "../atoms/realmAuthSettingsAtom.ts";
import { SessionAudits } from "../audits/SessionAudits.ts";
import { UserAudits } from "../audits/UserAudits.ts";
import { MyAvatarController } from "../controllers/MyAvatarController.ts";
import type { identities } from "../entities/identities.ts";
import type { sessions } from "../entities/sessions.ts";
import { DEFAULT_USER_REALM_NAME, type users } from "../entities/users.ts";
import { UserJobs } from "../jobs/UserJobs.ts";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import { SessionService } from "../services/SessionService.ts";
import { UserStorage } from "../storage/UserStorage.ts";

export type RealmPrimitive = IssuerPrimitive & WithLinkFn & WithLoginFn;

/**
 * Already configured realm for user management.
 *
 * Realm contains two roles: `admin` and `user`.
 *
 * - `admin`: Has full access to all resources and permissions.
 * - `user`: Has access to their own resources and permissions, but cannot access admin-level resources.
 *
 * Realm uses session management for handling user sessions.
 *
 * Environment Variables:
 * - `APP_SECRET`: Secret key for signing tokens (if not provided in options).
 */

export const $realm = (options: RealmOptions = {}): RealmPrimitive => {
  const { alepha } = $context();
  const sessionService = alepha.inject(SessionService);
  const securityProvider = alepha.inject(SecurityProvider);
  const realmProvider = alepha.inject(RealmProvider);

  const name = options.issuer?.name ?? DEFAULT_USER_REALM_NAME;

  // Merge features with defaults
  const features: RealmFeatures = {
    jobs: false,
    notifications: false,
    apiKeys: false,
    oauth: false,
    parameters: false,
    avatars: false,
    audits: false,
    ...options.features,
  };

  // `verifyEmailRequired`, `verifyPhoneRequired` and `resetPasswordAllowed`
  // need `features.notifications` to send their codes. That used to be
  // reconciled here by overwriting all three with `false`; it is now refused
  // by `RealmProvider.register` instead — see the note on
  // `assertNotificationsCoverSettings` for why silence was the wrong answer.
  // The check lives there rather than here so a realm registered straight
  // through the provider, as the tests do, is held to the same rule.
  const realmRegistration = realmProvider.register(name, options);

  // -------------------------------------------------------------------------------------------------------------------

  // Enable features based on configuration
  // Each feature registers its wrapper service which internally uses the module primitives

  if (features.avatars) {
    alepha.with(UserStorage);
    // The endpoints too, not just the storage they use. While they sat on the
    // always-registered `MyProfileController`, its `$inject(UserStorage)`
    // pulled the storage in anyway and both routes answered on every realm —
    // so this flag gated nothing observable, and the account UI showed an
    // avatar picker whether or not the realm wanted one.
    alepha.with(MyAvatarController);
  }

  if (features.audits) {
    alepha.with(UserAudits);
    alepha.with(SessionAudits);
  }

  if (features.jobs) {
    alepha.with(UserJobs);
  }

  if (features.notifications) {
    alepha.with(UserNotifications);
    alepha.with(AlephaApiVerification);
  }

  // -------------------------------------------------------------------------------------------------------------------

  // Collect custom resolvers that will be registered during $issuer.onInit()
  // This ensures they are registered AFTER the realm is created (not on the default test realm)
  const customResolvers: IssuerResolver[] = [
    ...(options.issuer?.resolvers ?? []),
  ];

  // Enable API key authentication - must be added to customResolvers before $issuer() call
  if (features.apiKeys) {
    alepha.with(AlephaApiKeys);
    const apiKeyService = alepha.inject(ApiKeyService);
    customResolvers.push(
      apiKeyService.createResolver({
        // Keys must die with their account — and must never grant more than
        // the owner currently holds, so a demotion takes effect immediately
        // instead of waiting for every outstanding key to expire.
        resolveOwner: async (userId) => {
          const user = await realmProvider
            .userRepository(name)
            .findById(userId);
          if (!user) {
            return undefined;
          }
          return { enabled: user.enabled === true, roles: user.roles };
        },
      }),
    );
  }

  const realm: RealmPrimitive = $issuer({
    ...options.issuer,
    name,
    secret: options.secret ?? securityProvider.secretKey,
    signing: options.signing,
    resolvers: customResolvers,
    roles: options.issuer?.roles ?? [
      {
        name: "admin",
        permissions: [
          {
            name: "*",
          },
        ],
      },
      {
        name: "user",
        default: true,
        permissions: [
          {
            name: "*",
            ownership: true,
            exclude: ["admin:*"],
          },
        ],
      },
    ],
    settings: {
      accessToken: {
        expiration: [15, "minutes"],
      },
      refreshToken: {
        expiration: [30, "days"],
      },
      onCreateSession: async (user, config) => {
        return sessionService.createSession(
          user,
          config.expiresIn,
          undefined,
          config.clientId,
        );
      },
      onRefreshSession: async (refreshToken) => {
        return sessionService.refreshSession(refreshToken);
      },
      onDeleteSession: async (refreshToken) => {
        await sessionService.deleteSession(refreshToken);
      },
      ...options.issuer?.settings,
    },
  });

  $permission({
    name: "admin:access",
  });

  // -------------------------------------------------------------------------------------------------------------------

  // Enable the OAuth 2.1 authorization server.
  // The OAuth module is realm-agnostic: it mints access tokens through an
  // issuer handed to it via `registerIssuer`. Here we register the realm's own
  // issuer plus a loader that maps a `users` row to a `UserAccount`.
  if (features.oauth) {
    alepha.with(AlephaOAuth);
    const oauthService = alepha.inject(OAuthClientService);

    // Point the OAuth controller at this realm so its endpoints mint tokens
    // through the issuer we register below. Merge with the current value so a
    // caller-configured `resource` path is preserved.
    const currentOAuthOptions =
      alepha.get(oauthOptions) ?? oauthOptions.options.default;
    alepha.set(oauthOptions, { ...currentOAuthOptions, realm: name });

    const loadUser = async (userId: string) => {
      const user = await sessionService.users(name).findOne({
        where: { id: { eq: userId }, realm: name },
      });
      if (!user) {
        throw new AlephaError(`User '${userId}' not found in realm '${name}'`);
      }
      const composedName =
        [user.firstName, user.lastName]
          .filter((s): s is string => !!s?.trim())
          .join(" ")
          .trim() || undefined;
      return {
        id: user.id,
        roles: user.roles,
        name: composedName,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        emailVerified: user.emailVerified,
        username: user.username,
        picture: user.picture,
        organization: user.organizationId ?? undefined,
        realm: name,
      };
    };

    oauthService.registerIssuer(name, realm, loadUser);

    // Tell the MCP Streamable HTTP transport to challenge unauthenticated
    // requests with an RFC 9728 401 (`WWW-Authenticate`), so MCP clients
    // can discover this OAuth server. Decoupled: the transport never
    // imports the OAuth module — it just reads its own options atom.
    // Harmless when no MCP transport is mounted; the atom is simply set.
    const currentMcpOptions =
      alepha.get(mcpStreamableHttpOptions) ??
      mcpStreamableHttpOptions.options.default;
    alepha.set(mcpStreamableHttpOptions, {
      ...currentMcpOptions,
      requireAuth: true,
    });
  }

  realm.link = (name: string) => {
    return (ctx: LinkAccountOptions) =>
      sessionService.link(name, ctx.user, realm.name);
  };

  realm.login = (name: string) => {
    return async (credentials: Credentials) => {
      const user = await sessionService.login(
        name,
        credentials.username,
        credentials.password,
        realm.name,
      );
      // Compose display name from first+last for OIDC `name` claim.
      // Without this, credentials-registered users appear as "Anonymous User".
      const composedName =
        [user.firstName, user.lastName]
          .filter((s): s is string => !!s?.trim())
          .join(" ")
          .trim() || undefined;
      return { ...user, name: composedName };
    };
  };

  const identities = options.identities ?? {
    credentials: true,
  };

  if (identities) {
    const auth: Record<string, AuthPrimitive> = {};
    if (identities.credentials) {
      auth.credentials = $authCredentials(realm);
    } else {
      // if credentials auth is disabled, disable registration as well
      realmRegistration.settings.registrationAllowed = false;
    }

    if (identities.google) {
      auth.google = $authGoogle(realm);
    }

    if (identities.github) {
      auth.github = $authGithub(realm);
    }

    if (identities.apple) {
      auth.apple = $authApple(realm);
    }

    if (identities.facebook) {
      auth.facebook = $authFacebook(realm);
    }

    if (identities.microsoft) {
      auth.microsoft = $authMicrosoft(realm);
    }

    if (identities.franceconnect) {
      auth.franceconnect = $authFranceConnect(realm);
    }

    alepha.with(() => auth);
  }

  if (features.parameters) {
    alepha.with(AlephaApiParameters);
    const settingsParam = $parameter({
      name: `api.realms.settings.${name}`,
      description: `Authentication and registration settings for realm "${name}"`,
      schema: realmAuthSettingsAtom.schema,
      default: realmRegistration.settings,
    });
    realmRegistration.settingsParameter = settingsParam;
    alepha.with(() => ({ [`realmSettings_${name}`]: settingsParam }));
  }

  return realm;
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RealmFeatures {
  /**
   * Will enable Job module.
   *
   * - Enable session purge functionality for cleaning up expired sessions.
   *
   * @default false
   */
  jobs?: boolean;

  /**
   * Enable notification system for password reset, verification emails, etc.
   *
   * Registers the notifications module itself, so there is nothing to add to
   * your application's `imports` alongside it.
   *
   * Required by `settings.verifyEmailRequired`,
   * `settings.verifyPhoneRequired` and `settings.resetPasswordAllowed` —
   * each completes by sending a code, so a realm that sets one of them with
   * this off is refused at boot rather than run with the setting ignored.
   *
   * @default false
   */
  notifications?: boolean;

  /**
   * Enable API key authentication for programmatic access.
   *
   * When enabled, users can create API keys to access protected endpoints
   * without using JWT tokens. API keys are useful for:
   * - Programmatic access (CLI tools, scripts)
   * - Long-lived authentication tokens
   * - Third-party integrations (MCP servers)
   *
   * API keys can be passed via:
   * - Query parameter: `?api_key=ak_xxx`
   * - Bearer header: `Authorization: Bearer ak_xxx`
   *
   * @default false
   */
  apiKeys?: boolean;

  /**
   * Enable the OAuth 2.1 authorization server.
   *
   * Exposes RFC 9728 / RFC 8414 metadata, RFC 7591 dynamic client
   * registration, and PKCE authorize/token endpoints so MCP clients
   * (e.g. Claude) can connect to a protected `/mcp` endpoint without an
   * API key in the query string.
   *
   * @default false
   */
  oauth?: boolean;

  /**
   * Enable runtime configuration management.
   *
   * Allows configuring realm settings at runtime with versioning and scheduled activation.
   *
   * @default false
   */
  parameters?: boolean;

  /**
   * Enable avatar uploads for user profiles.
   *
   * @default false
   */
  avatars?: boolean;

  /**
   * Enable audit trail for compliance and event logging.
   *
   * @default false
   */
  audits?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface RealmOptions {
  /**
   * Secret key for signing tokens.
   *
   * If not provided, the secret from the SecurityProvider will be used (usually from the APP_SECRET environment variable).
   */
  secret?: string;

  /**
   * Asymmetric signing config for this realm's tokens (OIDC provider mode).
   * When set, issued tokens are signed asymmetrically and the public keys are
   * JWKS-publishable. Default is HS256 via `secret`.
   */
  signing?: SigningConfig;

  /**
   * Issuer configuration options.
   *
   * It's already pre-configured for user management with admin and user roles.
   */
  issuer?: Partial<IssuerPrimitiveOptions>;

  /**
   * Override entities.
   */
  entities?: {
    users?: Repository<typeof users.schema>;
    identities?: Repository<typeof identities.schema>;
    sessions?: Repository<typeof sessions.schema>;
  };

  settings?: Partial<RealmAuthSettings>;

  identities?: {
    credentials?: true;
    google?: true;
    github?: true;
    apple?: true;
    facebook?: true;
    microsoft?: true;
    franceconnect?: true;
  };

  /**
   * Enable or disable realm features.
   *
   * Features control which modules are loaded with the realm.
   */
  features?: Partial<RealmFeatures>;
}
