import { $hook, $inject, Alepha, AlephaError, type Async } from "alepha";
import type { ParameterPrimitive } from "alepha/api/parameters";
import { CaptchaProvider } from "alepha/captcha";
import { $logger } from "alepha/logger";
import { $repository, type Repository } from "alepha/orm";

import {
  type RealmAuthSettings,
  realmAuthSettingsAtom,
} from "../atoms/realmAuthSettingsAtom.ts";
import { UserAudits } from "../audits/UserAudits.ts";
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
  /**
   * Answer every lookup that names no realm. At most one realm may carry it,
   * and it only matters once an application declares more than one.
   *
   * @see RealmProvider.defaultRealm
   */
  default?: boolean;
  repositories: RealmRepositories;
  settings: RealmAuthSettings;
  features: RealmFeatures;
  settingsParameter?: ParameterPrimitive<typeof realmAuthSettingsAtom.schema>;
  getSettings(): Promise<RealmAuthSettings>;
  isPreAuthorized?: RegistrationPreAuthorizationFn;
  bootstrapFirstUser?: boolean;
}

/**
 * What the app is told when a CLOSED realm meets a registration.
 *
 * Filled by the two entry points that can create an account
 * (`RegistrationService.createRegistrationIntent` and `SessionService.link`'s
 * OAuth first login) and handed to the closure the app registered on its
 * realm. The realm name is filled in by
 * {@link RealmProvider.preAuthorizeRegistration}, so a caller cannot pass one
 * that disagrees with the realm it asked.
 */
export interface RegistrationPreAuthorizationContext {
  /**
   * The address being registered.
   *
   * Never blank: a closed realm refuses a registration carrying no address
   * before the seam is consulted, since there would be nothing to vouch for.
   */
  email: string;

  /**
   * The realm the registration is for.
   */
  realm: string;

  /**
   * Which entry point is asking. The two differ in what they have already
   * proven, so an app that only trusts one of them can say so.
   */
  method: "credentials" | "oauth";

  /**
   * The OAuth provider, when `method` is `"oauth"`.
   */
  provider?: string;

  /**
   * Whether the identity provider asserted the address is verified.
   *
   * `undefined` on the credentials path, where nothing has been proven yet,
   * which is precisely why that path also carries a {@link token}.
   */
  emailVerified?: boolean;

  /**
   * The opaque pre-authorization token the caller supplied
   * (`preAuthToken` on the register request).
   *
   * The framework never reads it, never validates it and never logs it. It
   * exists so an app whose proof of pre-authorization is a secret in the
   * caller's hands (an invitation link, a signup code) can get that secret
   * to its own closure without reaching into the HTTP request.
   */
  token?: string;
}

/**
 * The app's answer, when it is more than "yes".
 *
 * Returning `true` is the same as returning `{}`; returning `false` or
 * `undefined` refuses.
 */
export interface RegistrationPreAuthorization {
  /**
   * Treat the address as already proven, so the credentials flow neither
   * sends a verification code nor asks for one, and the account still lands
   * `emailVerified: true`.
   *
   * Set this only when the pre-authorization was itself delivered to that
   * mailbox, an invitation link say. It is the app asserting the thing the
   * verification email would otherwise establish, so asserting it falsely
   * hands out verified accounts for addresses nobody proved.
   *
   * Ignored on the OAuth path, where the provider is the authority on whether
   * an address is verified and `trustProviderEmail` decides what to do when
   * it says nothing.
   */
  emailVerified?: boolean;
}

/**
 * The seam a realm fills to let SPECIFIC addresses through while
 * `registrationAllowed` is `false`.
 *
 * Same arrangement as `login` / `link` / the second-factor trio: the module
 * that owns the decision cannot import the app, so the app hands it a
 * closure. Absent, a closed realm behaves exactly as it always has.
 */
export type RegistrationPreAuthorizationFn = (
  context: RegistrationPreAuthorizationContext,
) => Async<boolean | RegistrationPreAuthorization | undefined>;

export class RealmProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  // Default repositories using $repository() for eager initialization
  protected readonly defaultIdentities = $repository(identities);
  protected readonly defaultSessions = $repository(sessions);
  protected readonly defaultUsers = $repository(users);
  protected readonly captcha = $inject(CaptchaProvider);

  protected realms = new Map<string, Realm>();

  /**
   * Realms already observed to hold at least one account.
   *
   * A table with a user in it can never go back to empty in a way that
   * should reopen anything, so the lookup runs once per realm and then
   * never again.
   */
  protected realmsWithUsers = new Set<string>();

  /**
   * Tells the operator, once the app is up, that the instance is still
   * waiting for its first account.
   *
   * This is what actually answers the takeover window that shipping closed
   * would have bought: someone who starts the container on a host that
   * already resolves publicly, and then walks away. Gitea, Grafana and
   * Jellyfin all say the same thing at the same moment.
   */
  protected readonly warnWhileEmpty = $hook({
    on: "ready",
    handler: async () => {
      for (const realm of this.realms.values()) {
        if (!realm.bootstrapFirstUser) {
          continue;
        }
        try {
          if (await this.isAwaitingFirstUser(realm.name)) {
            this.log.warn(
              "No accounts exist. Registration is open and the first account will become the administrator.",
              { realm: realm.name },
            );
          }
        } catch (error) {
          // A warning is not worth failing a boot over — and the table may
          // not exist yet on a runtime that migrates elsewhere.
          this.log.debug("Could not check for existing accounts", error);
        }
      }
    },
  });

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
    this.assertCaptchaProviderRegistered(realmName, realmOptions);
    this.assertBootstrapNotServerless(realmName, realmOptions);

    const realm: Realm = {
      name: realmName,
      default: realmOptions.issuer?.default,
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
        mfa: {
          ...realmAuthSettingsAtom.options.default.mfa,
          ...realmOptions.settings?.mfa,
        },
      },
      features,
      getSettings: async function () {
        if (this.settingsParameter) {
          return await this.settingsParameter.get();
        }
        return this.settings;
      },
      isPreAuthorized: realmOptions.isPreAuthorized,
      bootstrapFirstUser: realmOptions.bootstrapFirstUser,
    };
    this.realms.set(realmName, realm);
    return this.getRealm(realmName);
  }

  /**
   * Ask the app whether ONE address may register into a closed realm.
   *
   * Consulted by both entry points, and only after
   * `registrationAllowed === false` has been established, so a realm that is
   * open never runs it and a realm that filled no closure behaves exactly as
   * it did before this existed.
   *
   * Three properties this deliberately does NOT have, each one a way the
   * seam could have become a hole:
   *
   * - it is not a rate-limit bypass. The per-IP registration cap runs before
   *   the caller ever reaches the closed check, so a pre-authorized address
   *   is throttled like any other.
   * - it is not a captcha bypass. The captcha gate is further down the same
   *   method: an invitation proves an address, not a human.
   * - it does not answer differently. A refusal returns `undefined` and the
   *   caller throws the message a closed realm has always thrown, so a
   *   prober cannot tell a pre-authorized address from any other.
   *
   * `true` normalizes to `{}` so callers can treat any returned object as
   * "allowed" and read the hints off it.
   */
  public async preAuthorizeRegistration(
    realmName: string | undefined,
    context: Omit<RegistrationPreAuthorizationContext, "realm">,
  ): Promise<RegistrationPreAuthorization | undefined> {
    const realm = this.getRealm(realmName);
    if (!realm.isPreAuthorized) {
      return undefined;
    }
    // The realm name is filled here rather than taken from the caller: the
    // two could otherwise disagree, and the closure would be answering about
    // a realm nobody asked about.
    const result = await realm.isPreAuthorized({
      ...context,
      realm: realm.name,
    });
    if (!result) {
      return undefined;
    }
    return result === true ? {} : result;
  }

  /**
   * Whether the realm still holds no account at all.
   *
   * Answers `false` without touching the database for a realm that did not
   * ask for `bootstrapFirstUser`, and for one already observed to hold a
   * user, so nothing pays for a behaviour it did not turn on.
   *
   * A `LIMIT 1` lookup rather than a `COUNT`: the question is "any row at
   * all", and the answer is cached the moment it is yes.
   */
  public async isAwaitingFirstUser(realmName?: string): Promise<boolean> {
    const realm = this.getRealm(realmName);
    if (!realm.bootstrapFirstUser) {
      return false;
    }
    if (this.realmsWithUsers.has(realm.name)) {
      return false;
    }

    const existing = await realm.repositories.users.findOne({
      where: { realm: realm.name },
    });
    if (existing) {
      this.realmsWithUsers.add(realm.name);
      return false;
    }
    return true;
  }

  /**
   * The lockout guard: a CLOSED realm still accepts a registration while it
   * holds no account at all.
   *
   * A second consult next to {@link preAuthorizeRegistration}, so both entry
   * points get it from one place. It is not the main path — the self-hosted
   * image ships with registration open — and exists so that an operator who
   * sets `REGISTRATION_ALLOWED=false` on a fresh volume does not brick an
   * instance whose own setting has made the only account that could reopen
   * it unreachable.
   *
   * ⚠️ This loosens a setting the operator explicitly asked for, which is
   * exactly the shape that must never be quiet, so it logs at warn every
   * time it fires.
   */
  public async allowsBootstrapRegistration(
    realmName?: string,
  ): Promise<boolean> {
    if (!(await this.isAwaitingFirstUser(realmName))) {
      return false;
    }
    this.log.warn(
      "REGISTRATION_ALLOWED=false, but no accounts exist yet, so registration stays open until the first account is created.",
      { realm: this.getRealm(realmName).name },
    );
    return true;
  }

  /**
   * Promote a freshly created account to `admin` when it is the first in its
   * realm, so the operator who started the instance ends up owning it.
   *
   * The `isPreAuthorized` seam cannot do this: `admin` is a persisted role on
   * the user row, granted only by `ensureAdminRole` from `adminEmails` /
   * `adminUsernames`. That is why the option lives in the framework at all.
   *
   * ⚠️ **The rule is "oldest row in the realm", and it is what survives the
   * race.** Two concurrent registrations against an empty table both observe
   * zero before their inserts. Promoting on "it was empty when I looked"
   * yields two admins. Re-counting afterwards and promoting on `count === 1`
   * yields NONE, which is worse and is the easier one to write by accident.
   * Both racers agree on which row is oldest, so exactly one is promoted and
   * no transaction is needed.
   *
   * @returns whether the account was promoted.
   */
  public async promoteFirstUserToAdmin(
    user: { id: string; email?: string | null; roles: string[] },
    realmName?: string,
  ): Promise<boolean> {
    const realm = this.getRealm(realmName);
    if (!realm.bootstrapFirstUser || user.roles.includes("admin")) {
      return false;
    }

    const [oldest] = await realm.repositories.users.findMany({
      where: { realm: realm.name },
      // `id` breaks a tie: two rows inserted in the same millisecond would
      // otherwise order arbitrarily, and the two racers could disagree.
      orderBy: [
        { column: "createdAt", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
      limit: 1,
    });

    // Whichever way this goes, the realm now holds a user.
    this.realmsWithUsers.add(realm.name);

    if (!oldest || oldest.id !== user.id) {
      return false;
    }

    user.roles = [...user.roles.filter((role) => role !== "admin"), "admin"];
    await realm.repositories.users.updateById(user.id, { roles: user.roles });

    this.log.info(
      "First account in the realm promoted to admin via bootstrapFirstUser",
      { userId: user.id, realm: realm.name },
    );

    if (realm.features.audits) {
      await this.alepha.inject(UserAudits).user.log("role_change", {
        resourceType: "user",
        userId: user.id,
        userEmail: user.email ?? undefined,
        userRealm: realm.name,
        resourceId: user.id,
        description:
          "First account in the realm promoted to admin via bootstrapFirstUser",
        metadata: { addedRole: "admin", reason: "bootstrapFirstUser" },
      });
    }

    return true;
  }

  /**
   * Rejects `bootstrapFirstUser` on a serverless runtime.
   *
   * The behaviour is for a long-lived process an operator just started on
   * their own machine. On Workers it would cost a lookup over the users
   * table per registration attempt, on every isolate, forever — and a
   * freshly deployed Worker whose table happens to be empty would hand admin
   * to whoever registered first. Refused rather than ignored, the same way
   * `APP_SECRET_FILE` is.
   */
  protected assertBootstrapNotServerless(
    realmName: string,
    realmOptions: RealmOptions,
  ): void {
    if (!realmOptions.bootstrapFirstUser || !this.alepha.isServerless()) {
      return;
    }

    throw new AlephaError(
      `Realm "${realmName}" sets bootstrapFirstUser, which is refused on serverless runtimes: ` +
        `a freshly deployed instance with an empty users table would hand admin to whoever registers first. ` +
        `Grant the first administrator with settings.adminEmails instead.`,
    );
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
   * Rejects a realm that requires a captcha nothing can verify.
   *
   * Same shape as {@link assertNotificationsCoverSettings}, and for the same
   * reason: a security setting that silently does nothing is worse than one
   * that refuses. `alepha/captcha` binds `UnconfiguredCaptchaProvider` when
   * the app registered no provider, and that one refuses every token - so
   * without this, a production realm with `captchaRequired: true` would boot,
   * render the widget, and reject every single signup.
   *
   * Only an explicit `captchaRequired: true` can trip this; the atom defaults
   * it to `false`, so a container that merely registered `alepha/captcha`
   * still starts.
   */
  protected assertCaptchaProviderRegistered(
    realmName: string,
    realmOptions: RealmOptions,
  ): void {
    const settings = realmOptions.settings as
      | Record<string, unknown>
      | undefined;

    if (settings?.captchaRequired !== true || this.captcha.configured) {
      return;
    }

    throw new AlephaError(
      `Realm "${realmName}" sets captchaRequired but no CaptchaProvider is registered, ` +
        `so every token would be refused. Register one, e.g. ` +
        `alepha.with({ provide: CaptchaProvider, use: TurnstileCaptchaProvider }) ` +
        `with TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY set, or drop the setting.`,
    );
  }

  /**
   * Gets a registered realm by name, auto-creating default if needed.
   */
  public getRealm(realmName = DEFAULT_USER_REALM_NAME): Realm {
    let realm = this.realms.get(realmName);

    if (!realm) {
      if (realmName === DEFAULT_USER_REALM_NAME && this.realms.size > 0) {
        // Every realm-less caller in this module lands here, through the
        // parameter default. It used to answer with `realms[0]`, so the order
        // of FIELDS in a class decided which realm they all used - see
        // `SecurityProvider.defaultRealm`, which this mirrors.
        realm = this.defaultRealm();
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

  /**
   * The realm a caller that named none resolves against.
   *
   * One realm: that realm. Several: the one declared
   * `$realm({ issuer: { default: true } })`, and a refusal if none is - the
   * same rule, and the same wording, as `SecurityProvider.defaultRealm`.
   */
  public defaultRealm(): Realm {
    const realms = Array.from(this.realms.values());
    const declared = realms.filter((it) => it.default);

    if (declared.length === 1) {
      return declared[0];
    }
    if (realms.length === 1) {
      return realms[0];
    }
    if (realms.length === 0) {
      throw new AlephaError(
        "No realm is declared, please declare $realm in your application.",
      );
    }

    throw new AlephaError(
      declared.length > 1
        ? `Several realms are declared \`default: true\` (${declared
            .map((it) => it.name)
            .join(", ")}). Exactly one may be.`
        : `This application declares ${realms.length} realms (${realms
            .map((it) => it.name)
            .join(
              ", ",
            )}) and a lookup named none of them. Pass the realm, or mark one \`$realm({ issuer: { default: true } })\` to name the answer once.`,
    );
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
