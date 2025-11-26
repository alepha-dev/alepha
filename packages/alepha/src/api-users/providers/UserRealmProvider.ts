import { $hook, $inject, Alepha, AlephaError } from "alepha";
import {
  DEFAULT_USER_REALM_NAME,
  realmAuthSettingsAtom,
  type UserRealmOptions,
} from "alepha/api/users";
import { $repository, type Repository } from "alepha/orm";
import { $bucket } from "../../bucket";
import type { RealmAuthSettings } from "../atoms/realmAuthSettingsAtom.ts";
import { identities } from "../entities/identities";
import { sessions } from "../entities/sessions";
import { users } from "../entities/users";

export interface UserRealmRepositories {
  identities: Repository<typeof identities.schema>;
  sessions: Repository<typeof sessions.schema>;
  users: Repository<typeof users.schema>;
}

export interface UserRealm {
  name: string;
  repositories: UserRealmRepositories;
  settings: RealmAuthSettings;
}

export class UserRealmProvider {
  protected readonly alepha = $inject(Alepha);
  // Default repositories using $repository() for eager initialization
  protected readonly defaultIdentities = $repository(identities);
  protected readonly defaultSessions = $repository(sessions);
  protected readonly defaultUsers = $repository(users);

  protected realms = new Map<string, UserRealm>();

  public avatars = $bucket({
    maxSize: 5 * 1024 * 1024, // 5 MB
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  });

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: () => {
      this.alepha.state.set("alepha.server.security.system.user", {
        id: "00000000-0000-0000-0000-000000000000",
        name: "system",
        roles: ["admin"], // TODO: use realm config
      });
    },
  });

  public register(
    userRealmName: string,
    userRealmOptions: UserRealmOptions = {},
  ) {
    this.realms.set(userRealmName, {
      name: userRealmName,
      repositories: {
        identities:
          userRealmOptions.entities?.identities ?? this.defaultIdentities,
        sessions: userRealmOptions.entities?.sessions ?? this.defaultSessions,
        users: userRealmOptions.entities?.users ?? this.defaultUsers,
      },
      // TODO: Remove deep merge when alepha supports it natively
      settings: {
        ...realmAuthSettingsAtom.options.default,
        ...userRealmOptions.settings,
        passwordPolicy: {
          ...realmAuthSettingsAtom.options.default.passwordPolicy,
          ...userRealmOptions.settings?.passwordPolicy,
        },
      },
    });
  }

  /**
   * Gets a registered realm by name, auto-creating default if needed.
   */
  public getRealm(userRealmName = DEFAULT_USER_REALM_NAME): UserRealm {
    let realm = this.realms.get(userRealmName);

    if (!realm) {
      // Auto-register default realm for backward compatibility
      if (userRealmName === DEFAULT_USER_REALM_NAME) {
        this.register(userRealmName);
        realm = this.realms.get(userRealmName)!;
      } else {
        throw new AlephaError(
          `Missing user realm '${userRealmName}', please declare $userRealm in your application.`,
        );
      }
    }

    return realm;
  }

  public identityRepository(
    userRealmName = DEFAULT_USER_REALM_NAME,
  ): Repository<typeof identities.schema> {
    return this.getRealm(userRealmName).repositories.identities;
  }

  public sessionRepository(
    userRealmName = DEFAULT_USER_REALM_NAME,
  ): Repository<typeof sessions.schema> {
    return this.getRealm(userRealmName).repositories.sessions;
  }

  public userRepository(
    userRealmName = DEFAULT_USER_REALM_NAME,
  ): Repository<typeof users.schema> {
    return this.getRealm(userRealmName).repositories.users;
  }
}
