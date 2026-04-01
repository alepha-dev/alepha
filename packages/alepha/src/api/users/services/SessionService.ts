import { randomInt } from "node:crypto";
import { $inject, Alepha } from "alepha";
import type { FileController } from "alepha/api/files";
import { CacheProvider } from "alepha/cache";
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
import { UserAudits } from "../audits/UserAudits.ts";
import type { UserEntity } from "../entities/users.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";

export class SessionService {
  protected readonly alepha = $inject(Alepha);
  protected readonly fsp = $inject(FileSystemProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly log = $logger();
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly fileController = $client<FileController>();
  protected readonly cacheProvider = $inject(CacheProvider);

  protected userAudits(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    if (realm.features.audits) {
      return this.alepha.inject(UserAudits);
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

    await this.userAudits(userRealmName)?.recordUser("role_change", {
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
   * 1. Extract candidate from email prefix
   * 2. Sanitize against realm's usernameRegExp (strip invalid chars, truncate)
   * 3. Check case-insensitive uniqueness, append suffix (2, 3, ...) if taken
   * 4. Fall back to "user" + random 6-char alphanumeric if all else fails
   */
  protected async generateUniqueUsername(
    profile: OAuth2Profile,
    realmSettings: any,
    users: any,
  ): Promise<string> {
    const maxLength = 30;
    const maxSuffixAttempts = 10;

    // Extract candidate from email or profile name
    let candidate = profile.email?.split("@")[0] ?? profile.name ?? "";

    // Strip characters not allowed in usernames (keep alphanumeric, underscore, dot, hyphen)
    candidate = candidate.replace(/[^a-zA-Z0-9_.-]/g, "");

    // If realm has a custom regex, further sanitize
    if (realmSettings?.usernameRegExp) {
      try {
        const regex = new RegExp(realmSettings.usernameRegExp);
        if (!regex.test(candidate)) {
          // Strip to basic alphanumeric as safe fallback
          candidate = candidate.replace(/[^a-zA-Z0-9_]/g, "");
        }
      } catch {
        // Invalid regex, continue with sanitized candidate
      }
    }

    // Ensure minimum length
    if (candidate.length < 3) {
      candidate = `user${candidate}`;
    }

    // Truncate to leave room for suffix
    candidate = candidate.slice(0, maxLength - 2);

    // Check uniqueness (case-insensitive)
    const isAvailable = async (name: string) => {
      const existing = await users.findMany({
        where: { username: { contains: name } },
        limit: 1,
      });
      // Case-insensitive check
      return !existing.some(
        (u: any) => u.username?.toLowerCase() === name.toLowerCase(),
      );
    };

    if (await isAvailable(candidate)) {
      return candidate;
    }

    // Try with numeric suffix
    for (let i = 2; i <= maxSuffixAttempts + 1; i++) {
      const withSuffix = `${candidate}${i}`;
      if (withSuffix.length <= maxLength && (await isAvailable(withSuffix))) {
        return withSuffix;
      }
    }

    // Final fallback: random username
    const random = Math.random().toString(36).slice(2, 8);
    return `user${random}`;
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
   */
  protected async isLoginLocked(key: string, max: number): Promise<boolean> {
    try {
      const count = await this.cacheProvider.getTyped<number>(
        SessionService.LOGIN_CACHE_NAME,
        key,
      );
      return count != null && count >= max;
    } catch (error) {
      this.log.warn(
        "Failed to check login rate limit, allowing attempt",
        error,
      );
      return false;
    }
  }

  /**
   * Record a failed login attempt. Uses getTyped + setTyped (not incr) so that
   * each write refreshes the TTL — implementing sliding-window behavior.
   *
   * Returns `true` if this failure just crossed the lockout threshold.
   */
  protected async recordFailedLogin(
    key: string,
    max: number,
    windowMs: number,
  ): Promise<boolean> {
    try {
      const count =
        (await this.cacheProvider.getTyped<number>(
          SessionService.LOGIN_CACHE_NAME,
          key,
        )) ?? 0;
      const newCount = count + 1;
      await this.cacheProvider.setTyped(
        SessionService.LOGIN_CACHE_NAME,
        key,
        newCount,
        { ttl: windowMs },
      );
      return newCount === max;
    } catch (error) {
      this.log.warn("Failed to record failed login attempt", error);
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

            await this.userAudits(userRealmName)?.recordAuth("login_failed", {
              userRealm: name,
              description: "Username does not match required format",
              metadata: { provider, username },
            });

            throw new InvalidCredentialsError();
          }
        }
        where.username = { ilike: username };
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

        await this.userAudits(userRealmName)?.recordAuth("login_failed", {
          userRealm: name,
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

        await this.userAudits(userRealmName)?.recordAuth("login_failed", {
          userRealm: name,
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
            await this.userAudits(userRealmName)?.record(
              "security",
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

        await this.userAudits(userRealmName)?.recordAuth("login_failed", {
          userRealm: name,
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
            await this.userAudits(userRealmName)?.record(
              "security",
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
          await this.userAudits(userRealmName)?.record(
            "security",
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
        }

        throw new InvalidCredentialsError();
      }

      await this.userAudits(userRealmName)?.recordAuth("login", {
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
  ) {
    this.log.trace("Creating session", { userId: user.id, expiresIn });

    const request = this.alepha.store.get("alepha.http.request");
    const refreshToken = this.cryptoProvider.randomUUID();

    const expiresAt = this.dateTimeProvider
      .now()
      .add(expiresIn, "seconds")
      .toISOString();

    const session = await this.sessions(userRealmName).create({
      userId: user.id,
      expiresAt,
      ip: request?.ip,
      userAgent: request?.userAgent,
      refreshToken,
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

    const user = await this.users(userRealmName).getOne({
      where: {
        id: { eq: session.userId },
      },
    });

    // Auto-promote to admin if configured (handles "I promote you admin" case)
    await this.ensureAdminRole(user, userRealmName);

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

      await this.userAudits(userRealmName)?.recordAuth("logout", {
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

      await this.userAudits(userRealmName)?.recordAuth("login", {
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
        email: profile.email,
      },
    });

    if (existing) {
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

      await this.userAudits(userRealmName)?.recordAuth("login", {
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
    );

    const user = await users.create({
      realm: realm.name,
      username,
      email: profile.email,
      // we trust the OAuth2 provider
      emailVerified: true,
      roles: ["user"], // TODO: make default roles configurable via realm settings
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
    await this.userAudits(userRealmName)?.recordUser("create", {
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
    await this.userAudits(userRealmName)?.recordAuth("login", {
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
