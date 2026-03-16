import { $context } from "alepha";
import { AlephaApiKeys, ApiKeyService } from "alepha/api/keys";
import { AlephaApiParameters } from "alepha/api/parameters";
import { AlephaApiVerification } from "alepha/api/verifications";
import type { Repository } from "alepha/orm";
import {
  $issuer,
  $permission,
  type IssuerPrimitive,
  type IssuerPrimitiveOptions,
  type IssuerResolver,
  SecurityProvider,
} from "alepha/security";
import {
  $authCredentials,
  $authGithub,
  $authGoogle,
  type AuthPrimitive,
  type Credentials,
  type LinkAccountOptions,
  type WithLinkFn,
  type WithLoginFn,
} from "alepha/server/auth";
import type { RealmAuthSettings } from "../atoms/realmAuthSettingsAtom.ts";
import { UserAudits } from "../audits/UserAudits.ts";
import { UserBuckets } from "../buckets/UserBuckets.ts";
import type { identities } from "../entities/identities.ts";
import type { sessions } from "../entities/sessions.ts";
import { DEFAULT_USER_REALM_NAME, type users } from "../entities/users.ts";
import { UserJobs } from "../jobs/UserJobs.ts";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import { SessionService } from "../services/SessionService.ts";

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

  options.settings ??= {};

  // Merge features with defaults
  const features: RealmFeatures = {
    sessionPurge: false,
    notifications: false,
    apiKeys: false,
    parameters: false,
    avatars: false,
    audits: false,
    ...options.features,
  };

  // When notifications are disabled, force verification-dependent settings to false
  // These features require sending codes via email/SMS which won't work without notifications
  if (!features.notifications) {
    options.settings.verifyEmailRequired = false;
    options.settings.verifyPhoneRequired = false;
    options.settings.resetPasswordAllowed = false;
  }

  const realmRegistration = realmProvider.register(name, options);

  // -------------------------------------------------------------------------------------------------------------------

  // Enable features based on configuration
  // Each feature registers its wrapper service which internally uses the module primitives

  if (features.avatars) {
    alepha.with(UserBuckets);
  }

  if (features.audits) {
    alepha.with(UserAudits);
  }

  if (features.sessionPurge) {
    alepha.with(UserJobs);
  }

  if (features.notifications) {
    alepha.with(UserNotifications);
    alepha.with(AlephaApiVerification);
  }

  if (features.parameters) {
    // for now, we don't have $parameter related to users, we just register the module
    alepha.with(AlephaApiParameters);
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
    customResolvers.push(apiKeyService.createResolver());
  }

  const realm: RealmPrimitive = $issuer({
    ...options.issuer,
    name,
    secret: options.secret ?? securityProvider.secretKey,
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
        return sessionService.createSession(user, config.expiresIn);
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

  realm.link = (name: string) => {
    return (ctx: LinkAccountOptions) =>
      sessionService.link(name, ctx.user, realm.name);
  };

  realm.login = (name: string) => {
    return (credentials: Credentials) => {
      return sessionService.login(
        name,
        credentials.username,
        credentials.password,
        realm.name,
      );
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

    alepha.with(() => auth);
  }

  return realm;
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RealmFeatures {
  /**
   * Enable session purge functionality for cleaning up expired sessions.
   *
   * @default false
   */
  sessionPurge?: boolean;

  /**
   * Enable notification system for password reset, verification emails, etc.
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
  };

  /**
   * Enable or disable realm features.
   *
   * Features control which modules are loaded with the realm.
   */
  features?: Partial<RealmFeatures>;
}
