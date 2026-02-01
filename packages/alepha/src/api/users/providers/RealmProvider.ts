import { $inject, Alepha, AlephaError } from "alepha";
import { $repository, type Repository } from "alepha/orm";
import {
  type RealmAuthSettings,
  realmAuthSettingsAtom,
} from "../atoms/realmAuthSettingsAtom.ts";
import { identities } from "../entities/identities.ts";
import { sessions } from "../entities/sessions.ts";
import { DEFAULT_USER_REALM_NAME, users } from "../entities/users.ts";
import type { RealmFeatures, RealmOptions } from "../primitives/$realm.ts";

export interface RealmRepositories {
  identities: Repository<typeof identities.schema>;
  sessions: Repository<typeof sessions.schema>;
  users: Repository<typeof users.schema>;
}

export interface Realm {
  name: string;
  repositories: RealmRepositories;
  settings: RealmAuthSettings;
  features: RealmFeatures;
}

export class RealmProvider {
  protected readonly alepha = $inject(Alepha);
  // Default repositories using $repository() for eager initialization
  protected readonly defaultIdentities = $repository(identities);
  protected readonly defaultSessions = $repository(sessions);
  protected readonly defaultUsers = $repository(users);

  protected realms = new Map<string, Realm>();

  public register(realmName: string, realmOptions: RealmOptions = {}) {
    // Merge features with defaults
    const features: RealmFeatures = {
      jobs: false,
      notifications: false,
      apiKeys: false,
      parameters: false,
      files: false,
      audits: false,
      organizations: false,
      ...realmOptions.features,
    };

    this.realms.set(realmName, {
      name: realmName,
      repositories: {
        identities: realmOptions.entities?.identities ?? this.defaultIdentities,
        sessions: realmOptions.entities?.sessions ?? this.defaultSessions,
        users: realmOptions.entities?.users ?? this.defaultUsers,
      },
      // TODO: Remove deep merge when alepha supports it natively
      settings: {
        ...realmAuthSettingsAtom.options.default,
        ...realmOptions.settings,
        passwordPolicy: {
          ...realmAuthSettingsAtom.options.default.passwordPolicy,
          ...realmOptions.settings?.passwordPolicy,
        },
      },
      features,
    });
    return this.getRealm(realmName);
  }

  /**
   * Gets a registered realm by name, auto-creating default if needed.
   */
  public getRealm(realmName = DEFAULT_USER_REALM_NAME): Realm {
    let realm = this.realms.get(realmName);

    if (!realm) {
      // Auto-register default realm for backward compatibility
      const realms = Array.from(this.realms.values());
      const firstRealm = realms[0];
      if (realmName === DEFAULT_USER_REALM_NAME && firstRealm) {
        realm = firstRealm;
      } else if (this.alepha.isTest()) {
        realm = this.register(realmName); // Auto-create default realm in tests
      } else {
        throw new AlephaError(
          `Missing realm '${realmName}', please declare $realm in your application.`,
        );
      }
    }

    return realm;
  }

  public identityRepository(
    realmName = DEFAULT_USER_REALM_NAME,
  ): Repository<typeof identities.schema> {
    return this.getRealm(realmName).repositories.identities;
  }

  public sessionRepository(
    realmName = DEFAULT_USER_REALM_NAME,
  ): Repository<typeof sessions.schema> {
    return this.getRealm(realmName).repositories.sessions;
  }

  public userRepository(
    realmName = DEFAULT_USER_REALM_NAME,
  ): Repository<typeof users.schema> {
    return this.getRealm(realmName).repositories.users;
  }
}
