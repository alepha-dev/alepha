import { randomInt } from "node:crypto";
import { $inject, Alepha } from "alepha";
import type { FileController } from "alepha/api/files";
import { DatabaseCacheProvider } from "alepha/cache/database";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
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
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import { UsernameSlugger } from "./UsernameSlugger.ts";

export class SessionService {
  protected readonly alepha = $inject(Alepha);
  protected readonly fsp = $inject(FileSystemProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly log = $logger();
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly fileController = $client<FileController>();
  /**
   * The login lockout counters, pinned to SQL rather than the app's default
   * cache.
   *
   * The default is runtime-dependent: memory on Node, Cloudflare KV on
   * workerd. Neither is acceptable here. Memory is per-process, so a counter
   * written on one instance is invisible to the next request on another. KV is
   * worse: it is bound as the workerd default whether or not the app ever
   * provisioned a namespace, and when it wasn't it skips its own
   * initialization and throws on every call — which is exactly how this
   * lockout came to be silently disabled in production.
   *
   * SQL is the only backend that is present wherever this service is (it
   * already owns the `users` table it is protecting) and strongly consistent
   * on every runtime, D1 included.
   */
  protected readonly cacheProvider = $inject(DatabaseCacheProvider);
  protected readonly usernameSlugger = $inject(UsernameSlugger);

  protected userAudits(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    if (realm.features.audits) {
      return this.alepha.inject(UserAudits);
    }
    return undefined;
  }

  protected sessionAudits(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    if (realm.features.audits) {
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
    _realmSettings: any,
    _users: any,
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

  protected static readonly LOGIN_CACHE_NAME = "login-rate-limit";

  /**
   * Check if a login key is currently locked out.
   * Read-only — does not increment the counter.
   *
   * **Fails closed.** A counter store that cannot be read cannot say an
   * attacker is under the threshold, and answering "not locked" turns an
   * outage into an open door — brute force with the rate limiter removed, for
   * as long as the store is down and with nothing in the response to show it.
   * Refusing instead costs legitimate users their logins, loudly, which is the
   * failure someone will actually come and fix.
   */
  protected async isLoginLocked(key: string, max: number): Promise<boolean> {
    try {
      const count = await this.cacheProvider.getTyped<number>(
        SessionService.LOGIN_CACHE_NAME,
        key,
      );
      return count != null && count >= max;
    } catch (error) {
      this.log.error(
        "Failed to check login rate limit, denying attempt",
        error,
      );
      return true;
    }
  }

  /**
   * Record a failed login attempt.
   *
   * Returns `true` if this failure just crossed the lockout threshold.
   *
   * **Atomic, and a fixed window.** `incr` is one
   * `INSERT ... ON CONFLICT DO UPDATE` against `cache_entries`, so concurrent
   * attempts cannot interleave. The read-modify-write this replaces could:
   * a hundred parallel attempts all read the same count and all wrote
   * `count + 1`, moving the counter by one — the lockout was bypassable by
   * anyone willing to send their guesses at once rather than in sequence.
   *
   * That read-modify-write bought a sliding window, because each write
   * re-armed the TTL. `incr` stamps the expiry when the counter is created and
   * never extends it, so the window is now fixed — and that is the better
   * behaviour anyway: under a sliding window anyone who knows a username can
   * hold that account locked forever by failing one login just inside every
   * window. A fixed window bounds the lockout to `windowMs`.
   *
   * A write that fails is logged at `error` and swallowed: the attempt it
   * belongs to is being rejected either way, and the return value only decides
   * whether to raise the "just locked" audit and notification. The door it
   * would otherwise leave open is closed by {@link isLoginLocked}, which
   * denies when the same store cannot be read.
   */
  protected async recordFailedLogin(
    key: string,
    max: number,
    windowMs: number,
  ): Promise<boolean> {
    try {
      const count = await this.cacheProvider.incr(
        SessionService.LOGIN_CACHE_NAME,
        key,
        1,
        windowMs,
      );
      return count === max;
    } catch (error) {
      this.log.error("Failed to record failed login attempt", error);
      return false;
    }
  }

  /**
   * Validate user credentials and return the user if valid.
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
    const isPhone = /^[+\d][\d\s()-]+$/.test(username);
    const isUsername = !isEmail && !isPhone;
    const identities = this.identities(userRealmName);
    const users = this.users(userRealmName);

    // IP rate limit check (global, cross-realm) — before any DB work
    const request = this.alepha.store.get("alepha.http.request");
    const ipKey = request?.ip ? `login:ip:${request.ip}` : undefined;

    if (ipKey) {
      const ipLocked = await this.isLoginLocked(
        ipKey,
        loginRateLimit.ipMaxAttempts,
      );
      if (ipLocked) {
        this.log.warn("Login blocked — IP rate limit exceeded", {
          ip: request?.ip,
        });
        throw new InvalidCredentialsError();
      }
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

            throw new InvalidCredentialsError();
          }
        }
        // Case-insensitive EQUALITY, not a LIKE pattern. `ilike` on the raw
        // identifier made `_` and `%` wildcards, so `admi_` matched `admin`
        // and `findOne` picked one arbitrarily — wrong semantics on the auth
        // hot path. Mirrors the `(realm, LOWER(username))` unique index.
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

        // Only increment IP counter (no user ID to track)
        if (ipKey) {
          const justLocked = await this.recordFailedLogin(
            ipKey,
            loginRateLimit.ipMaxAttempts,
            loginRateLimit.windowMs,
          );
          if (justLocked) {
            await this.sessionAudits(userRealmName)?.security.log(
              "rate_limited",
              {
                userRealm: name,
                success: false,
                description:
                  "IP temporarily locked due to too many failed login attempts",
                metadata: { ip: request?.ip },
              },
            );
          }
        }

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

        throw new InvalidCredentialsError();
      }

      // Account rate limit check (per-realm)
      const accountKey = `login:account:${name}:${user.id}`;
      const accountLocked = await this.isLoginLocked(
        accountKey,
        loginRateLimit.accountMaxAttempts,
      );
      if (accountLocked) {
        this.log.warn("Login blocked — account rate limit exceeded", {
          userId: user.id,
          realm: name,
        });
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
        this.log.error("Identity has no password configured", {
          provider,
          username,
          identityId: identity.id,
          realm: name,
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

        // Record failed attempt on both IP and account counters
        if (ipKey) {
          const ipJustLocked = await this.recordFailedLogin(
            ipKey,
            loginRateLimit.ipMaxAttempts,
            loginRateLimit.windowMs,
          );
          if (ipJustLocked) {
            await this.sessionAudits(userRealmName)?.security.log(
              "rate_limited",
              {
                userRealm: name,
                success: false,
                description:
                  "IP temporarily locked due to too many failed login attempts",
                metadata: { ip: request?.ip },
              },
            );
          }
        }

        const accountJustLocked = await this.recordFailedLogin(
          accountKey,
          loginRateLimit.accountMaxAttempts,
          loginRateLimit.windowMs,
        );
        if (accountJustLocked) {
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

          // Notify user about account lockout
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

    // getOne() throws DbEntityNotFoundError if not found — never returns null.
    // No null check needed here.
    const session = await this.sessions(userRealmName).getOne({
      where: {
        refreshToken: { eq: refreshToken },
      },
    });

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
      this.log.debug("OAuth2 profile has no email, returning profile as-is", {
        provider,
        profileSub: profile.sub,
      });
      return {
        id: profile.sub,
        ...profile,
      };
    }

    const existing = await users.findOne({
      where: {
        realm: realm.name,
        email: profile.email,
      },
    });

    if (existing) {
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

    if (realmSettings?.registrationAllowed === false && !isAdmin) {
      this.log.warn("Registration not allowed for realm via OAuth2", {
        provider,
        userRealmName,
      });
      throw new BadRequestError("Account doesn't exist");
    }

    const username = await this.generateUniqueUsername(
      profile,
      realmSettings,
      users,
      userRealmName,
    );

    const user = await users.create({
      realm: realm.name,
      username,
      email: profile.email,
      firstName: profile.given_name,
      lastName: profile.family_name,
      // we trust the OAuth2 provider
      emailVerified: true,
      roles: realmSettings.defaultRoles,
    });

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

    // Auto-promote to admin if configured
    await this.ensureAdminRole(user, userRealmName);

    return user;
  }
}
