import { $context } from "alepha";
import { AlephaApiAudits } from "alepha/api/audits";
import { AlephaApiFiles } from "alepha/api/files";
import type { Repository } from "alepha/orm";
import {
  $issuer,
  type IssuerPrimitive,
  type IssuerPrimitiveOptions,
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
import type { identities } from "../entities/identities.ts";
import type { sessions } from "../entities/sessions.ts";
import { DEFAULT_USER_REALM_NAME, type users } from "../entities/users.ts";
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

  if (options.settings.emailRequired) {
    options.settings.emailEnabled = true;
  }

  if (options.settings.usernameRequired) {
    options.settings.usernameEnabled = true;
  }

  if (options.settings.phoneRequired) {
    options.settings.phoneEnabled = true;
  }

  const realmRegistration = realmProvider.register(name, options);

  alepha.with(AlephaApiFiles);
  alepha.with(AlephaApiAudits);

  const realm: RealmPrimitive = $issuer({
    ...options.issuer,
    name,
    secret: options.secret ?? securityProvider.secretKey,
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

  modules?: {
    files?: boolean;
    audits?: boolean;
    jobs?: boolean;
  };
}
