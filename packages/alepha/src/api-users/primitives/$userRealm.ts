import { $context } from "alepha";
import { AlephaApiFiles } from "alepha/api/files";
import { AlephaApiJobs } from "alepha/api/jobs";
import type { Repository } from "alepha/orm";
import {
  $realm,
  type RealmPrimitive,
  type RealmPrimitiveOptions,
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
import { AlephaApiAudits } from "../../api-audits/index.ts";
import type { RealmAuthSettings } from "../atoms/realmAuthSettingsAtom.ts";
import type { identities } from "../entities/identities.ts";
import type { sessions } from "../entities/sessions.ts";
import { DEFAULT_USER_REALM_NAME, type users } from "../entities/users.ts";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";
import { SessionService } from "../services/SessionService.ts";

export type UserRealmPrimitive = RealmPrimitive & WithLinkFn & WithLoginFn;

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

export const $userRealm = (
  options: UserRealmOptions = {},
): UserRealmPrimitive => {
  const { alepha } = $context();
  const sessionService = alepha.inject(SessionService);
  const securityProvider = alepha.inject(SecurityProvider);
  const userRealmProvider = alepha.inject(UserRealmProvider);
  const name = options.realm?.name ?? DEFAULT_USER_REALM_NAME;

  const userRealm = userRealmProvider.register(name, options);

  if (options.modules?.audits) {
    alepha.with(AlephaApiAudits);
  }

  if (options.modules?.files) {
    alepha.with(AlephaApiFiles);
  }

  if (options.modules?.jobs) {
    alepha.with(AlephaApiJobs);
  }

  const realm: UserRealmPrimitive = $realm({
    ...options.realm,
    name,
    secret: options.secret ?? securityProvider.secretKey,
    roles: options.realm?.roles ?? [
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
      ...options.realm?.settings,
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
      userRealm.settings.registrationAllowed = false;
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

export interface UserRealmOptions {
  /**
   * Secret key for signing tokens.
   *
   * If not provided, the secret from the SecurityProvider will be used (usually from the APP_SECRET environment variable).
   */
  secret?: string;

  /**
   * Realm configuration options.
   *
   * It's already pre-configured for user management with admin and user roles.
   */
  realm?: Partial<RealmPrimitiveOptions>;

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
