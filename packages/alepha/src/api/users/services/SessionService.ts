import { randomInt } from "node:crypto";

import { $inject, Alepha } from "alepha";
import type { FileController } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $rateLimit, type RateLimitResult } from "alepha/rate-limit";
import {
  CryptoProvider,
  InvalidCredentialsError,
  type UserAccount,
} from "alepha/security";
import { BadRequestError, UnauthorizedError } from "alepha/server";
import type { OAuth2Profile } from "alepha/server/auth";
import { $client } from "alepha/server/links";
import { FileSystemProvider } from "alepha/system";

import { SessionAudits } from "../audits/SessionAudits.ts";
import { UserAudits } from "../audits/UserAudits.ts";
import type { UserEntity } from "../entities/users.ts";
import type { AttemptBudget } from "../interfaces/AttemptBudget.ts";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import { UsernameSlugger } from "./UsernameSlugger.ts";
import { UserService } from "./UserService.ts";

export class SessionService {
  protected readonly alepha = $inject(Alepha);
  protected readonly fsp = $inject(FileSystemProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly log = $logger();
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly fileController = $client<FileController>();
  /**
   * The login lockout counters: `login:ip` (global, cross-realm) and
   * `login:account` (per realm and user), limit and window from the realm's
   * `loginRateLimit` settings. They are actor state, so they are shared exactly
   * as far as the app's actors are: one process on Memory, every instance once
   * `REDIS_URL` is set, a Durable Object per key on workerd. No `REDIS_URL`
   * means one instance (the topology rule of the rate-limit guide). Both fail closed: a
   * counter store that cannot answer refuses the login.
   */
  protected readonly loginIp = $rateLimit({
    name: "login:ip",
    limit: (input: AttemptBudget) => input.max,
    window: (input: AttemptBudget) => input.windowMs,
    key: (input: AttemptBudget) => input.key,
  });
  protected readonly loginAccount = $rateLimit({
    name: "login:account",
    limit: (input: AttemptBudget) => input.max,
    window: (input: AttemptBudget) => input.windowMs,
    key: (input: AttemptBudget) => input.key,
  });
  protected readonly usernameSlugger = $inject(UsernameSlugger);
  protected readonly userService = $inject(UserService);

  protected userAudits(realmName?: string) {
    // Registered by every `$realm` whatever its features say; a realm
    // registered straight through `RealmProvider` (tests) may not have it.
    if (this.alepha.has(UserAudits)) {
      return this.alepha.inject(UserAudits);
    }
    return undefined;
  }

  protected sessionAudits(realmName?: string) {
    // Registered by every `$realm` whatever its features say; a realm
    // registered straight through `RealmProvider` (tests) may not have it.
    if (this.alepha.has(SessionAudits)) {
      return this.alepha.inject(SessionAudits);
    }
    return undefined;
  }

  protected userNotifications(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    if (realm.features.notifications) {
      return this.alepha.inject(UserNotifications);
    }
    return undefined;
  }

  public users(userRealmName?: string) {
    return this.realmProvider.userRepository(userRealmName);
  }

  public sessions(userRealmName?: string) {
    return this.realmProvider.sessionRepository(userRealmName);
  }

  public identities(userRealmName?: string) {
    return this.realmProvider.identityRepository(userRealmName);
  }

  /**
   * Check if user should be auto-promoted to admin based on adminEmails/adminUsernames settings.
   * If user matches and doesn't have admin role, promote them.
   */
  protected async ensureAdminRole(
    user: {
      id: string;
      email?: string | null;
      username?: string | null;
      roles: string[];
    },
    userRealmName?: string,
  ): Promise<boolean> {
    if (user.roles.includes("admin")) return false;

    const realm = this.realmProvider.getRealm(userRealmName);
    const settings = await realm.getSettings();
    const { name } = realm;
    const adminEmails = settings.adminEmails ?? [];
    const adminUsernames = settings.adminUsernames ?? [];

    const isAdminByEmail = user.email && adminEmails.includes(user.email);
    const isAdminByUsername =
      user.username && adminUsernames.includes(user.username);

    if (!isAdminByEmail && !isAdminByUsername) return false;

    // Promote to admin
    user.roles = [...user.roles.filter((r) => r !== "admin"), "admin"];
    await this.users(userRealmName).updateById(user.id, { roles: user.roles });

    const reason = isAdminByEmail ? "adminEmails" : "adminUsernames";
    this.log.info(`User auto-promoted to admin via ${reason} setting`, {
      userId: user.id,
      email: user.email,
      username: user.username,
      realm: name,
    });

    await this.userAudits(userRealmName)?.user.log("role_change", {
      resourceType: "user",
      userId: user.id,
      userEmail: user.email ?? undefined,
      userRealm: name,
      resourceId: user.id,
      description: `User auto-promoted to admin via ${reason} setting`,
      metadata: { addedRole: "admin", reason },
    });

    return true;
  }

  /**
   * Generate a unique username from an OAuth profile.
   *
   * Routes through {@link UsernameSlugger}, which is the same code path as
   * `username: "email"` registration. The OAuth profile's email is the
   * primary signal; if absent (rare — most IDPs return one), we fall back
   * to `profile.name`, then to a random handle. The slugger applies the
   * realm's `usernameBlocklist` and retries on collision.
   */
  protected async generateUniqueUsername(
    profile: OAuth2Profile,
    realmName?: string,
  ): Promise<string> {
    const seed =
      profile.email ??
      profile.name ??
      `user-${Math.random().toString(36).slice(2, 8)}`;
    const base = this.usernameSlugger.slug(seed);
    return this.usernameSlugger.pickAvailable(realmName, base);
  }

  /**
   * Random delay to prevent timing attacks (50-200ms)
   * Uses cryptographically secure random number generation
   */
  protected randomDelay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, randomInt(50, 201)));
  }

  /**
   * Which IP budget an HTTP login attempt is counted against.
   *
   * No address is not a reason to skip the budget: `getRequestIp` answers
   * nothing without `TRUST_PROXY` on a runtime with no socket, and every
   * pre-compare failure then wrote an audit row with nothing bounding it. One
   * shared bucket keeps those attempts bounded, as OAuth DCR does. A call with
   * no HTTP request at all (a script, a spec) is not counted per IP.
   */
  protected ipBucket(ip: string | undefined): string {
    if (ip) return ip;
    this.log.warn(
      "Login attempt with no client address; counting it against the shared bucket. Set TRUST_PROXY if this app is behind a proxy.",
    );
    return "unknown";
  }

  /**
   * Audit an IP lock, once: when a failure that keeps its IP slot is the one
   * that filled the counter.
   */
  protected async auditIpLock(
    ip: RateLimitResult | undefined,
    max: number,
    realmName: string,
    userRealmName?: string,
  ): Promise<void> {
    if (ip?.count !== max) return;
    const request = this.alepha.store.get("alepha.http.request");
    await this.sessionAudits(userRealmName)?.security.log("rate_limited", {
      userRealm: realmName,
      success: false,
      description:
        "IP temporarily locked due to too many failed login attempts",
      metadata: { ip: request?.ip },
    });
  }

  /**
   * Validate user credentials and return the user if valid.
   *
   * Two counters, both taken before the password is compared (#Q2529), and
   * given back only by a right password:
   *
   * 1. `login:ip`, first, before the anti-timing delay and any DB work. A
   *    refusal throws and writes nothing. Every later failure keeps the slot,
   *    so a failure before the compare (bad format, unknown user, disabled
   *    account, no password) is bounded too.
   * 2. `login:account`, immediately before the compare, once the identity is
   *    known to have a password: an account that signs in through a provider
   *    only never spends account slots on attempts that cannot succeed.
   *
   * Lock audits are written here, not by the limiter: the limit-th attempt
   * fills the counter before its compare, and a right password on it must
   * raise nothing.
   */
  public async login(
    provider: string,
    username: string,
    password: string,
    userRealmName?: string,
  ): Promise<UserEntity> {
    const realm = this.realmProvider.getRealm(userRealmName);
    const settings = await realm.getSettings();
    const { name } = realm;
    const { loginRateLimit } = settings;
    const isEmail = username.includes("@");
    // Phone numbers are E.164 (`users.phoneNumber` is `z.e164()`), so they
    // start with "+". Matching any digit string here classified an all-digit
    // username as a phone number, and that user could never log in.
    const isPhone =
      settings.phoneNumber !== "none" && /^\+[\d\s()-]+$/.test(username);
    const isUsername = !isEmail && !isPhone;
    const identities = this.identities(userRealmName);
    const users = this.users(userRealmName);

    // IP budget (global, cross-realm), taken before any DB work.
    const request = this.alepha.store.get("alepha.http.request");
    const ip = request
      ? await this.loginIp.consume({
          key: this.ipBucket(request.ip),
          max: loginRateLimit.ipMaxAttempts,
          windowMs: loginRateLimit.windowMs,
        })
      : undefined;
    if (ip && !ip.allowed) {
      this.log.warn("Login blocked — IP rate limit exceeded", {
        ip: request?.ip,
        reason: ip.reason,
      });
      throw new InvalidCredentialsError();
    }

    await this.randomDelay();

    try {
      const where = users.createQueryWhere();

      where.realm = name;

      if (settings.username !== "none" && isUsername) {
        // validate username format if regex is provided
        if (settings.usernameRegExp) {
          const regex = new RegExp(settings.usernameRegExp);
          if (!regex.test(username)) {
            this.log.warn("Username does not match required format", {
              provider,
              username,
              realm: name,
            });

            await this.sessionAudits(userRealmName)?.auth.log("login", {
              userRealm: name,
              success: false,
              description: "Username does not match required format",
              metadata: { provider, username },
            });
            await this.auditIpLock(
              ip,
              loginRateLimit.ipMaxAttempts,
              name,
              userRealmName,
            );

            throw new InvalidCredentialsError();
          }
        }
        // Case-insensitive EQUALITY, not a LIKE pattern. `ilike` on the raw
        // identifier made `_` and `%` wildcards, so `admi_` matched `admin`
        // and `findOne` picked one arbitrarily — wrong semantics on the auth
        // hot path. Mirrors the `(realm, username COLLATE NOCASE)` unique index.
        where.username = { eqInsensitive: username };
      } else if (settings.email !== "none" && isEmail) {
        where.email = username;
      } else if (settings.phoneNumber !== "none" && isPhone) {
        where.phoneNumber = username;
      } else {
        this.log.warn("Invalid login identifier format", {
          provider,
          username,
          realm: name,
        });

        await this.sessionAudits(userRealmName)?.auth.log("login", {
          userRealm: name,
          success: false,
          description: "Invalid login identifier format",
          metadata: { provider, username },
        });
        await this.auditIpLock(
          ip,
          loginRateLimit.ipMaxAttempts,
          name,
          userRealmName,
        );

        throw new InvalidCredentialsError();
      }

      const user = await users.findOne({ where });
      if (!user) {
        this.log.warn("User not found during login attempt", {
          provider,
          username,
          realm: name,
        });

        await this.sessionAudits(userRealmName)?.auth.log("login", {
          userRealm: name,
          success: false,
          description: "User not found",
          metadata: { provider, username },
        });
        await this.auditIpLock(
          ip,
          loginRateLimit.ipMaxAttempts,
          name,
          userRealmName,
        );

        throw new InvalidCredentialsError();
      }

      // Check if user account is enabled
      if (!user.enabled) {
        this.log.warn("Login attempt for disabled account", {
          userId: user.id,
          realm: name,
        });

        await this.sessionAudits(userRealmName)?.auth.log("login", {
          userRealm: name,
          success: false,
          resourceId: user.id,
          description: "Login attempt for disabled account",
          metadata: { provider, username },
        });
        await this.auditIpLock(
          ip,
          loginRateLimit.ipMaxAttempts,
          name,
          userRealmName,
        );

        throw new InvalidCredentialsError();
      }

      const identity = await identities.getOne({
        where: {
          provider: { eq: provider },
          userId: { eq: user.id },
        },
      });

      const storedPassword = identity.password;
      if (!storedPassword) {
        // An account that signs in through a provider only: a refusal, not
        // a fault, and no account slot is spent on it.
        this.log.warn("Identity has no password configured", {
          provider,
          username,
          identityId: identity.id,
          realm: name,
        });
        await this.auditIpLock(
          ip,
          loginRateLimit.ipMaxAttempts,
          name,
          userRealmName,
        );
        throw new InvalidCredentialsError();
      }

      // Account budget (per realm), taken just before the compare so
      // concurrent guesses cannot all slip under the cap (#Q2529). A refusal
      // keeps the IP slot and writes nothing.
      const account = await this.loginAccount.consume({
        key: `${name}:${user.id}`,
        max: loginRateLimit.accountMaxAttempts,
        windowMs: loginRateLimit.windowMs,
      });
      if (!account.allowed) {
        this.log.warn("Login blocked — account rate limit exceeded", {
          userId: user.id,
          realm: name,
          reason: account.reason,
        });
        throw new InvalidCredentialsError();
      }

      const valid = await this.cryptoProvider.verifyPassword(
        password,
        storedPassword,
      );

      if (!valid) {
        this.log.warn("Invalid password during login attempt", {
          provider,
          username,
          realm: name,
        });

        await this.sessionAudits(userRealmName)?.auth.log("login", {
          userRealm: name,
          success: false,
          resourceId: user.id,
          description: "Invalid password",
          metadata: { provider, username },
        });
        await this.auditIpLock(
          ip,
          loginRateLimit.ipMaxAttempts,
          name,
          userRealmName,
        );

        // This failure filling the counter is what "just locked" means.
        if (account.count === loginRateLimit.accountMaxAttempts) {
          await this.sessionAudits(userRealmName)?.security.log(
            "rate_limited",
            {
              userRealm: name,
              resourceId: user.id,
              success: false,
              description:
                "Account temporarily locked due to too many failed login attempts",
              metadata: { userId: user.id },
            },
          );

          // Notify user about account lockout.
          //
          // Deliberately NOT `inline`, and it is not an oversight. This mail
          // goes to the account owner, who at this point is very likely not
          // the person driving the request: the whole reason we are here is
          // repeated failed passwords. Blocking the login response on it
          // turns response time into an account-enumeration oracle for the
          // attacker, and hands them a way to slow the endpoint down.
          if (user.email) {
            const lockoutMinutes = Math.round(loginRateLimit.windowMs / 60_000);
            await this.userNotifications(userRealmName)?.accountLockout.push({
              contact: user.email,
              variables: { email: user.email, lockoutMinutes },
            });
          }
        }

        throw new InvalidCredentialsError();
      }

      // A right password costs nothing: both slots go back.
      if (account.ticket) await this.loginAccount.refund(account.ticket);
      if (ip?.ticket) await this.loginIp.refund(ip.ticket);

      await this.sessionAudits(userRealmName)?.auth.log("login", {
        userId: user.id,
        userEmail: user.email ?? undefined,
        userRealm: name,
        resourceId: user.id,
        description: `User logged in via ${provider}`,
        metadata: { provider, username },
      });

      // Auto-promote to admin if configured
      await this.ensureAdminRole(user, userRealmName);

      return user;
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw error;
      }

      this.log.warn("Error during login attempt", error);

      throw new InvalidCredentialsError();
    }
  }

  public async createSession(
    user: UserAccount,
    expiresIn: number,
    userRealmName?: string,
    clientId?: string,
    scopes?: string[],
  ) {
    this.log.trace("Creating session", { userId: user.id, expiresIn });

    const request = this.alepha.store.get("alepha.http.request");
    const refreshToken = this.cryptoProvider.randomUUID();

    const expiresAt = this.dateTimeProvider
      .now()
      .add(expiresIn, "seconds")
      .toISOString();

    const nowIso = this.dateTimeProvider.nowISOString();

    const session = await this.sessions(userRealmName).create({
      userId: user.id,
      expiresAt,
      lastUsedAt: nowIso,
      ip: request?.ip,
      country: request?.geo?.country,
      userAgent: request?.userAgent,
      refreshToken,
      clientId,
      scopes,
    });

    await this.users(userRealmName).updateById(user.id, {
      lastLoginAt: nowIso,
    });

    this.log.info("Session created", {
      sessionId: session.id,
      userId: user.id,
      ip: request?.ip,
    });

    return {
      refreshToken,
      sessionId: session.id,
    };
  }

  public async refreshSession(refreshToken: string, userRealmName?: string) {
    this.log.trace("Refreshing session");

    // An unknown token is an authentication failure, not a missing entity:
    // getOne() used to answer 404 with the table name in the message.
    const session = await this.sessions(userRealmName).findOne({
      where: {
        refreshToken: { eq: refreshToken },
      },
    });
    if (!session) {
      throw new UnauthorizedError("Invalid refresh token");
    }

    const now = this.dateTimeProvider.now();
    const expiresAt = this.dateTimeProvider.of(session.expiresAt);

    if (this.dateTimeProvider.of(session.expiresAt) < now) {
      this.log.debug("Session expired during refresh", {
        sessionId: session.id,
        userId: session.userId,
      });
      await this.sessions(userRealmName).deleteById(session.id);
      throw new UnauthorizedError("Session expired");
    }

    // Idle timeout check — opt-in via realm settings.
    // Falls back to createdAt when lastUsedAt is null (pre-migration rows or
    // sessions that never refreshed since the column was introduced).
    const realm = this.realmProvider.getRealm(userRealmName);
    const settings = await realm.getSettings();
    const idleMs = settings.refreshToken?.expirationIdle;
    if (idleMs && idleMs > 0) {
      const lastUsedRef = session.lastUsedAt ?? session.createdAt;
      const idleSince = now.diff(this.dateTimeProvider.of(lastUsedRef));
      if (idleSince > idleMs) {
        this.log.info("Session expired (idle timeout)", {
          sessionId: session.id,
          userId: session.userId,
          idleMs: idleSince,
          thresholdMs: idleMs,
        });
        await this.sessions(userRealmName).deleteById(session.id);
        throw new UnauthorizedError("Session expired");
      }
    }

    const user = await this.users(userRealmName).getOne({
      where: {
        id: { eq: session.userId },
      },
    });

    // The tables are shared between realms: a session row found here may
    // belong to a user of another realm, and this issuer must not sign an
    // access token (with that realm's roles) for it.
    if (user.realm !== realm.name) {
      this.log.warn("Session refresh across realms refused", {
        sessionId: session.id,
        userRealm: user.realm,
        realm: realm.name,
      });
      throw new UnauthorizedError("Invalid refresh token");
    }

    // Check if user account is still enabled
    if (!user.enabled) {
      this.log.warn("Session refresh for disabled account", {
        userId: user.id,
        sessionId: session.id,
      });
      await this.sessions(userRealmName).deleteById(session.id);
      throw new UnauthorizedError("Account disabled");
    }

    // Auto-promote to admin if configured (handles "I promote you admin" case)
    await this.ensureAdminRole(user, userRealmName);

    // Update lastUsedAt — sliding-window for idle timeout enforcement.
    await this.sessions(userRealmName).updateById(session.id, {
      lastUsedAt: now.toISOString(),
    });

    this.log.debug("Session refreshed", {
      sessionId: session.id,
      userId: session.userId,
    });

    return {
      user,
      expiresIn: expiresAt.unix() - now.unix(),
      sessionId: session.id,
      // Carried so the OAuth token endpoint can bind a refresh to the client
      // the session was issued to. Undefined for ordinary password logins.
      clientId: session.clientId,
      // The grant's scope ids, resolved to a permission list by the issuer
      // on this very refresh.
      scopes: session.scopes,
    };
  }

  public async deleteSession(refreshToken: string, userRealmName?: string) {
    this.log.trace("Deleting session");

    // Get session info before deletion for audit
    const session = await this.sessions(userRealmName).findOne({
      where: { refreshToken: { eq: refreshToken } },
    });

    await this.sessions(userRealmName).deleteOne({
      refreshToken,
    });
    this.log.debug("Session deleted");

    if (session) {
      const { name } = this.realmProvider.getRealm(userRealmName);

      await this.sessionAudits(userRealmName)?.auth.log("logout", {
        userId: session.userId,
        userRealm: name,
        sessionId: session.id,
        description: "User logged out",
      });
    }
  }

  public async link(
    provider: string,
    profile: OAuth2Profile,
    userRealmName?: string,
  ) {
    this.log.trace("Linking OAuth2 profile", {
      provider,
      profileSub: profile.sub,
      email: profile.email,
    });

    const realm = this.realmProvider.getRealm(userRealmName);
    const identities = this.identities(userRealmName);
    const users = this.users(userRealmName);

    const identity = await identities.findOne({
      where: {
        provider,
        providerUserId: profile.sub,
      },
    });

    // existing identity found, return associated user
    if (identity) {
      this.log.debug("Existing identity found", {
        provider,
        identityId: identity.id,
        userId: identity.userId,
      });

      const user = await users.getById(identity.userId);

      // `login()` and `refreshSession()` refuse a disabled account; this
      // path used to let one back in through its OAuth identity.
      if (!user.enabled) {
        this.log.warn("OAuth2 login refused for disabled account", {
          provider,
          userId: user.id,
        });
        await this.sessionAudits(userRealmName)?.auth.log("login", {
          userId: user.id,
          userRealm: realm.name,
          success: false,
          description: `OAuth2 login refused: account disabled (${provider})`,
          metadata: { provider },
        });
        throw new BadRequestError("Account disabled");
      }

      await this.sessionAudits(userRealmName)?.auth.log("login", {
        userId: user.id,
        userEmail: user.email ?? undefined,
        userRealm: realm.name,
        resourceId: user.id,
        description: `User logged in via OAuth2 (${provider})`,
        metadata: { provider, providerUserId: profile.sub },
      });

      // Auto-promote to admin if configured
      await this.ensureAdminRole(user, userRealmName);

      return user;
    }

    if (!profile.email) {
      // Returning the bare profile used to send `profile.sub` down the
      // session path as a user id, which ended in a foreign-key error (or,
      // without FK enforcement, a token for a user row that does not exist).
      this.log.warn("OAuth2 profile has no email, refusing login", {
        provider,
        profileSub: profile.sub,
      });
      throw new BadRequestError(
        "The identity provider did not supply an email address",
      );
    }

    const existing = await users.findOne({
      where: {
        realm: realm.name,
        email: profile.email,
      },
    });

    if (existing) {
      if (!existing.enabled) {
        this.log.warn("OAuth2 auto-link refused for disabled account", {
          provider,
          userId: existing.id,
        });
        throw new BadRequestError("Account disabled");
      }

      // Auto-linking by email requires positive proof of ownership: a provider
      // that omits `email_verified` has NOT asserted the email is verified, and
      // linking on it would let an attacker who registered the victim's email
      // at that provider take over the local account.
      if (profile.email_verified !== true) {
        this.log.warn(
          "OAuth2 profile email not verified by provider, refusing auto-link",
          { provider, email: profile.email, userId: existing.id },
        );
        throw new BadRequestError(
          "Cannot link account: email not verified by provider",
        );
      }

      this.log.debug("Linking OAuth2 profile to existing user by email", {
        provider,
        profileSub: profile.sub,
        userId: existing.id,
        email: profile.email,
      });
      await identities.create({
        provider,
        providerUserId: profile.sub,
        userId: existing.id,
      });

      await this.sessionAudits(userRealmName)?.auth.log("login", {
        userId: existing.id,
        userEmail: existing.email ?? undefined,
        userRealm: realm.name,
        resourceId: existing.id,
        description: `OAuth2 identity linked to existing user (${provider})`,
        metadata: { provider, providerUserId: profile.sub, linked: true },
      });

      // Auto-promote to admin if configured
      await this.ensureAdminRole(existing, userRealmName);

      return existing;
    }

    const realmSettings = await realm.getSettings();
    const adminEmails = realmSettings?.adminEmails ?? [];
    const isAdmin = profile.email && adminEmails.includes(profile.email);

    if (
      realmSettings?.registrationAllowed === false &&
      !isAdmin &&
      // Same lockout guard as the credentials path: a realm still holding no
      // account has no administrator who could reopen it.
      !(await this.realmProvider.allowsBootstrapRegistration(userRealmName))
    ) {
      // Same seam as the credentials path, so a closed realm is not open on
      // one entry point and shut on the other. `profile.email_verified` goes
      // with it: an app may well want to refuse a provider that has asserted
      // nothing, and only the app can weigh that against what it knows.
      //
      // The answer's `emailVerified` hint is deliberately NOT read here. On
      // this path the provider is the authority, and `trustProviderEmail`
      // below already decides what an unverified profile is worth; letting
      // the closure override it would hand out verified accounts on the word
      // of an address the provider itself would not vouch for.
      const preAuthorized = await this.realmProvider.preAuthorizeRegistration(
        userRealmName,
        {
          email: profile.email,
          method: "oauth",
          provider,
          emailVerified: profile.email_verified,
        },
      );
      if (!preAuthorized) {
        this.log.warn("Registration not allowed for realm via OAuth2", {
          provider,
          userRealmName,
        });
        // Unchanged message. A pre-authorized address that fails must be
        // indistinguishable from one that was never invited.
        throw new BadRequestError("Account doesn't exist");
      }
      this.log.debug("OAuth2 first login pre-authorized for a closed realm", {
        provider,
        userRealmName,
      });
    }

    const username = await this.generateUniqueUsername(profile, userRealmName);

    // A provider that sends `email_verified` is believed either way. One that
    // omits it has asserted nothing, and the account used to be created
    // verified regardless: anyone able to register the victim's address at
    // such a provider got a verified local account for it, which is the
    // credential every "sign in with your email" flow downstream trusts.
    const emailVerified =
      profile.email_verified ?? realmSettings.trustProviderEmail !== false;

    const user = await users.create({
      realm: realm.name,
      username,
      email: profile.email,
      firstName: profile.given_name,
      lastName: profile.family_name,
      emailVerified,
      roles: realmSettings.defaultRoles,
    });

    if (!emailVerified && profile.email) {
      this.log.debug("OAuth2 profile email unverified, sending verification", {
        provider,
        userId: user.id,
      });
      await this.userService.requestEmailVerification(
        profile.email,
        userRealmName,
      );
    }

    if (profile.picture) {
      this.log.debug("Fetching user profile picture from OAuth2 provider", {
        provider,
        url: profile.picture,
      });
      try {
        const response = await fetch(profile.picture);
        const file = this.fsp.createFile({
          response,
        });
        if (response.ok && response.body) {
          const fileEntity = await this.fileController.uploadFile(
            {
              body: { file },
            },
            {
              user,
            },
          );
          await users.updateById(user.id, { picture: fileEntity.id });
        }
      } catch (error) {
        this.log.warn("Failed to fetch user profile picture", error);
      }
    }

    await this.identities(userRealmName).create({
      provider,
      providerUserId: profile.sub,
      userId: user.id,
    });

    this.log.info("New user created via OAuth2 link", {
      provider,
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    // Audit: user created via OAuth
    await this.userAudits(userRealmName)?.user.log("create", {
      resourceType: "user",
      userId: user.id,
      userEmail: user.email ?? undefined,
      userRealm: realm.name,
      resourceId: user.id,
      description: `User created via OAuth2 (${provider})`,
      metadata: {
        provider,
        providerUserId: profile.sub,
        username: user.username,
        email: user.email,
      },
    });

    // Audit: login event
    await this.sessionAudits(userRealmName)?.auth.log("login", {
      userId: user.id,
      userEmail: user.email ?? undefined,
      userRealm: realm.name,
      resourceId: user.id,
      description: `First login via OAuth2 (${provider})`,
      metadata: { provider, providerUserId: profile.sub, firstLogin: true },
    });

    // The first account in the realm owns the instance. A no-op unless the
    // realm set `bootstrapFirstUser`; runs before `ensureAdminRole`, which
    // then finds the role already there and does nothing.
    await this.realmProvider.promoteFirstUserToAdmin(user, userRealmName);

    // Auto-promote to admin if configured
    await this.ensureAdminRole(user, userRealmName);

    return user;
  }
}
