import { $context } from "alepha";
import type { Repository } from "alepha/orm";
import {
  $realm,
  type RealmDescriptorOptions,
  SecurityProvider,
} from "alepha/security";
import type { identities } from "../entities/identities.ts";
import type { sessions } from "../entities/sessions.ts";
import type { users } from "../entities/users.ts";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";
import type { LoginSettings } from "../schemas/loginSettingsSchema.ts";
import { SessionService } from "../services/SessionService.ts";

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
export const $userRealm = (options: UserRealmOptions = {}) => {
  const { alepha } = $context();
  const sessionService = alepha.inject(SessionService);
  const securityProvider = alepha.inject(SecurityProvider);
  const userRealmProvider = alepha.inject(UserRealmProvider);

  userRealmProvider.register("default", options);

  return $realm({
    ...options.realm,
    name: options.realm?.name ?? "users",
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
  realm?: Partial<RealmDescriptorOptions>;

  /**
   * Override entities.
   */
  entities?: {
    users?: Repository<typeof users.schema>;
    identities?: Repository<typeof identities.schema>;
    sessions?: Repository<typeof sessions.schema>;
  };

  settings?: LoginSettings;
}
