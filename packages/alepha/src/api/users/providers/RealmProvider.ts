import { $inject, Alepha, AlephaError } from "alepha";
import type { ParameterPrimitive } from "alepha/api/parameters";
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
  settingsParameter?: ParameterPrimitive<typeof realmAuthSettingsAtom.schema>;
  getSettings(): Promise<RealmAuthSettings>;
}

export class RealmProvider {
  protected readonly alepha = $inject(Alepha);
  // Default repositories using $repository() for eager initialization
  protected readonly defaultIdentities = $repository(identities);
  protected readonly defaultSessions = $repository(sessions);
  protected readonly defaultUsers = $repository(users);

  protected realms = new Map<string, Realm>();

  public register(realmName: string, realmOptions: RealmOptions = {}) {
    if (realmName.includes(".")) {
      throw new AlephaError(
        `Realm name "${realmName}" must not contain dots — dots are reserved for parameter tree paths`,
      );
    }

    // Merge features with defaults
    const features: RealmFeatures = {
      jobs: false,
      notifications: false,
      apiKeys: false,
      parameters: false,
      avatars: false,
      audits: false,
      ...realmOptions.features,
    };

    this.assertNotificationsCoverSettings(realmName, features, realmOptions);

    const realm: Realm = {
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
        loginRateLimit: {
          ...realmAuthSettingsAtom.options.default.loginRateLimit,
          ...realmOptions.settings?.loginRateLimit,
        },
        refreshToken: {
          ...realmAuthSettingsAtom.options.default.refreshToken,
          ...realmOptions.settings?.refreshToken,
        },
      },
      features,
      getSettings: async function () {
        if (this.settingsParameter) {
          return await this.settingsParameter.get();
        }
        return this.settings;
      },
    };
    this.realms.set(realmName, realm);
    return this.getRealm(realmName);
  }

  /**
   * Rejects a realm that asks for a code it has no way to send.
   *
   * `verifyEmailRequired`, `verifyPhoneRequired` and `resetPasswordAllowed`
   * each complete only by delivering a code, which is what
   * `features.notifications` wires up. Asking for one without the other is a
   * contradiction with no safe resolution, so it is refused at boot rather
   * than resolved silently.
   *
   * It used to be resolved silently, in `$realm`, by overwriting the three
   * settings with `false`. That turned a security setting into a lie: the
   * shop asked for `resetPasswordAllowed: true` and shipped to production
   * with the reset endpoint rejecting every request and the "forgot
   * password" link hidden, and nothing anywhere said so. Downgrading a
   * security setting is the one outcome that must never be quiet.
   *
   * Settings left unset are not affected — the atom already defaults all
   * three to `false`, so only an explicit `true` can contradict.
   */
  protected assertNotificationsCoverSettings(
    realmName: string,
    features: RealmFeatures,
    realmOptions: RealmOptions,
  ): void {
    if (features.notifications) {
      return;
    }

    const settings = realmOptions.settings as
      | Record<string, unknown>
      | undefined;

    const contradictions = (
      [
        "verifyEmailRequired",
        "verifyPhoneRequired",
        "resetPasswordAllowed",
      ] as const
    ).filter((setting) => settings?.[setting] === true);

    if (!contradictions.length) {
      return;
    }

    throw new AlephaError(
      `Realm "${realmName}" sets ${contradictions.join(", ")} but features.notifications is off. ` +
        `Each of these completes by sending a code, so none of them can work. ` +
        `Set features: { notifications: true } on the realm, or drop the setting.`,
    );
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
