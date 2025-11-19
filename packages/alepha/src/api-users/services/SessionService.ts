import { randomInt } from "node:crypto";
import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { CryptoProvider, InvalidCredentialsError, type UserAccount } from "alepha/security";
import { type ServerRequest, UnauthorizedError } from "alepha/server";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";

export class SessionService {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly log = $logger();
  protected readonly userRealmProvider = $inject(UserRealmProvider);

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
    return new Promise((resolve) =>
      setTimeout(resolve, randomInt(50, 201)),
    );
  }

  public async login(provider: string, username: string, password: string, userRealmName?: string) {
    try {
      const identity = await this.identities(userRealmName)
        .findOne({
          where: {
            provider: { eq: provider },
            providerUserId: { eq: username },
          },
        })
        .catch((error) => {
          this.log.warn("Identity not found during login attempt", {
            provider,
            username,
            error: error.message,
          });
          return undefined;
        });

      if (!identity) {
        await this.randomDelay();
        throw new InvalidCredentialsError();
      }

      const storedPassword = identity.providerData?.password;
      if (!storedPassword) {
        this.log.error("Identity has no password configured", {
          provider,
          username,
          identityId: identity.id,
        });
        await this.randomDelay();
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
        });
        await this.randomDelay();
        throw new InvalidCredentialsError();
      }

      const user = await this.users(userRealmName)
        .findOne({
          where: {
            id: { eq: identity.userId },
          },
        })
        .catch((error) => {
          this.log.error("User not found for valid identity", {
            provider,
            username,
            userId: identity.userId,
            error: error.message,
          });
          return undefined;
        });

      if (!user) {
        await this.randomDelay();
        throw new InvalidCredentialsError();
      }

      await this.randomDelay();
      return user;
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw error;
      }

      this.log.error("Unexpected error during login", {
        provider,
        username,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.randomDelay();
      throw new InvalidCredentialsError();
    }
  }

  public async createSession(user: UserAccount, expiresIn: number, userRealmName?: string) {
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

    return {
      refreshToken,
      sessionId: session.id,
    };
  }

  public async refreshSession(refreshToken: string, userRealmName?: string) {
    const session = await this.sessions(userRealmName).findOne({
      where: {
        refreshToken: { eq: refreshToken },
      },
    });

    const now = this.dateTimeProvider.now();
    const expiresAt = this.dateTimeProvider.of(session.expiresAt);

    if (this.dateTimeProvider.of(session.expiresAt) < now) {
      await this.sessions(userRealmName).deleteById(refreshToken);
      throw new UnauthorizedError("Session expired");
    }

    const user = await this.users(userRealmName).findOne({
      where: {
        id: { eq: session.userId },
      },
    });

    return {
      user,
      expiresIn: expiresAt.unix() - now.unix(),
      sessionId: session.id,
    };
  }

  public async deleteSession(refreshToken: string, userRealmName?: string) {
    await this.sessions(userRealmName).deleteOne({
      refreshToken,
    });
  }

  // TODO: alepha/identity and replace profile: any by provider: OAuth2Profile
  public async link(provider: string, profile: any, userRealmName?: string) {
    const identity = await this.identities(userRealmName)
      .findOne({
        where: {
          provider,
          providerUserId: profile.sub,
        },
      })
      .catch(() => undefined);

    if (identity) {
      return this.users(userRealmName).findOne({
        where: {
          id: identity.userId,
        },
      });
    }

    if (!profile.email) {
      return {
        id: profile.sub,
        ...profile,
      };
    }

    const existing = await this.users(userRealmName)
      .findOne({
        where: {
          email: profile.email,
        },
      })
      .catch(() => undefined);

    if (existing) {
      await this.identities(userRealmName).create({
        provider,
        providerUserId: profile.sub,
        userId: existing.id,
      });
      return existing;
    }

    const newUser = await this.users(userRealmName).create({
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      roles: ["user"],
    });

    await this.identities(userRealmName).create({
      provider,
      providerUserId: profile.sub,
      userId: newUser.id,
    });

    return newUser;
  }
}
