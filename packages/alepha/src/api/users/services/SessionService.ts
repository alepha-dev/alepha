import { randomInt } from "node:crypto";
import { $inject, Alepha } from "alepha";
import { AuditService } from "alepha/api/audits";
import type { FileController } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import {
  CryptoProvider,
  InvalidCredentialsError,
  type UserAccount,
} from "alepha/security";
import { type ServerRequest, UnauthorizedError } from "alepha/server";
import type { OAuth2Profile } from "alepha/server/auth";
import { $client } from "alepha/server/links";
import type { UserEntity } from "../entities/users.ts";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";

export class SessionService {
  protected readonly alepha = $inject(Alepha);
  protected readonly fsp = $inject(FileSystemProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly log = $logger();
  protected readonly userRealmProvider = $inject(UserRealmProvider);
  protected readonly fileController = $client<FileController>();
  protected readonly auditService = $inject(AuditService);

  public users(userRealmName?: string) {
    return this.userRealmProvider.userRepository(userRealmName);
  }

  public sessions(userRealmName?: string) {
    return this.userRealmProvider.sessionRepository(userRealmName);
  }

  public identities(userRealmName?: string) {
    return this.userRealmProvider.identityRepository(userRealmName);
  }

  /**
   * Random delay to prevent timing attacks (50-200ms)
   * Uses cryptographically secure random number generation
   */
  protected randomDelay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, randomInt(50, 201)));
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
    const { settings, name } = this.userRealmProvider.getRealm(userRealmName);
    const isEmail = username.includes("@");
    const isPhone = /^[+\d][\d\s()-]+$/.test(username);
    const isUsername = !isEmail && !isPhone;
    const identities = this.identities(userRealmName);
    const users = this.users(userRealmName);

    await this.randomDelay();

    try {
      const where = users.createQueryWhere();

      where.realm = name;

      if (settings.usernameEnabled !== false && isUsername) {
        where.username = username;
      } else if (settings.emailEnabled !== false && isEmail) {
        where.email = username;
      } else if (settings.phoneEnabled === true && isPhone) {
        where.phoneNumber = username;
      } else {
        this.log.warn("Invalid login identifier format", {
          provider,
          username,
          realm: name,
        });

        await this.auditService.recordAuth("login_failed", {
          userRealm: name,
          description: "Invalid login identifier format",
          metadata: { provider, username },
        });

        throw new InvalidCredentialsError();
      }

      const user = await users.findOne({ where }).catch(() => undefined);
      if (!user) {
        this.log.warn("User not found during login attempt", {
          provider,
          username,
          realm: name,
        });

        await this.auditService.recordAuth("login_failed", {
          userRealm: name,
          description: "User not found",
          metadata: { provider, username },
        });

        throw new InvalidCredentialsError();
      }

      const identity = await identities.findOne({
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

        await this.auditService.recordAuth("login_failed", {
          userRealm: name,
          resourceId: user.id,
          description: "Invalid password",
          metadata: { provider, username },
        });

        throw new InvalidCredentialsError();
      }

      await this.auditService.recordAuth("login", {
        userId: user.id,
        userEmail: user.email ?? undefined,
        userRealm: name,
        resourceId: user.id,
        description: `User logged in via ${provider}`,
        metadata: { provider, username },
      });

      return user;
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        // TODO: store failed login attempts (with request data) and lock account after threshold
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

    const request = this.alepha.context.get<ServerRequest>("request");
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

    const session = await this.sessions(userRealmName).findOne({
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
      await this.sessions(userRealmName).deleteById(refreshToken);
      throw new UnauthorizedError("Session expired");
    }

    const user = await this.users(userRealmName).findOne({
      where: {
        id: { eq: session.userId },
      },
    });

    this.log.debug("Session refreshed", {
      sessionId: session.id,
      userId: session.userId,
    });

    const { name } = this.userRealmProvider.getRealm(userRealmName);

    await this.auditService.recordAuth("token_refresh", {
      userId: user.id,
      userEmail: user.email ?? undefined,
      userRealm: name,
      sessionId: session.id,
      description: "Session token refreshed",
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
    const session = await this.sessions(userRealmName)
      .findOne({
        where: { refreshToken: { eq: refreshToken } },
      })
      .catch(() => undefined);

    await this.sessions(userRealmName).deleteOne({
      refreshToken,
    });
    this.log.debug("Session deleted");

    if (session) {
      const { name } = this.userRealmProvider.getRealm(userRealmName);

      await this.auditService.recordAuth("logout", {
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

    const realm = this.userRealmProvider.getRealm(userRealmName);
    const identities = this.identities(userRealmName);
    const users = this.users(userRealmName);

    const identity = await identities
      .findOne({
        where: {
          provider,
          providerUserId: profile.sub,
        },
      })
      .catch(() => undefined);

    // existing identity found, return associated user
    if (identity) {
      this.log.debug("Existing identity found", {
        provider,
        identityId: identity.id,
        userId: identity.userId,
      });

      const user = await users.findById(identity.userId);

      await this.auditService.recordAuth("login", {
        userId: user.id,
        userEmail: user.email ?? undefined,
        userRealm: realm.name,
        resourceId: user.id,
        description: `User logged in via OAuth2 (${provider})`,
        metadata: { provider, providerUserId: profile.sub },
      });

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

    const existing = await users
      .findOne({
        where: {
          email: profile.email,
        },
      })
      .catch(() => undefined);

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

      await this.auditService.recordAuth("login", {
        userId: existing.id,
        userEmail: existing.email ?? undefined,
        userRealm: realm.name,
        resourceId: existing.id,
        description: `OAuth2 identity linked to existing user (${provider})`,
        metadata: { provider, providerUserId: profile.sub, linked: true },
      });

      return existing;
    }

    // TODO: check usernames for uniqueness, add suffix if needed (e.g. john.doe1)
    // TODO: username must match a-zA-Z0-9._-

    const user = await users.create({
      realm: realm.name,
      username: profile.email.split("@")[0],
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
    await this.auditService.recordUser("create", {
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
    await this.auditService.recordAuth("login", {
      userId: user.id,
      userEmail: user.email ?? undefined,
      userRealm: realm.name,
      resourceId: user.id,
      description: `First login via OAuth2 (${provider})`,
      metadata: { provider, providerUserId: profile.sub, firstLogin: true },
    });

    return user;
  }
}
