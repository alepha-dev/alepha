import { $inject } from "alepha";
import type { VerificationController } from "alepha/api/verifications";
import { $logger } from "alepha/logger";
import { type Page, parseQueryString } from "alepha/orm";
import { BadRequestError } from "alepha/server";
import { $client } from "alepha/server/links";
import type { UserEntity } from "../entities/users.ts";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";
import type { CreateUser } from "../schemas/createUserSchema.ts";
import type { UpdateUser } from "../schemas/updateUserSchema.ts";
import type { UserQuery } from "../schemas/userQuerySchema.ts";

export class UserService {
  protected readonly log = $logger();
  protected readonly verificationController = $client<VerificationController>();
  protected readonly userNotifications = $inject(UserNotifications);
  protected readonly userRealmProvider = $inject(UserRealmProvider);

  public users(userRealmName?: string) {
    return this.userRealmProvider.userRepository(userRealmName);
  }

  /**
   * Request email verification for a user.
   * @param email - The email address to verify.
   * @param userRealmName - Optional realm name.
   * @param method - The verification method: "code" (default) or "link".
   * @param verifyUrl - Base URL for verification link (required when method is "link").
   */
  public async requestEmailVerification(
    email: string,
    userRealmName?: string,
    method: "code" | "link" = "code",
    verifyUrl?: string,
  ): Promise<boolean> {
    this.log.trace("Requesting email verification", {
      email,
      userRealmName,
      method,
    });

    const user = await this.users(userRealmName)
      .findOne({
        where: { email: { eq: email } },
      })
      .catch(() => undefined);

    if (!user) {
      this.log.debug("Email verification requested for non-existent user", {
        email,
      });
      return true;
    }

    if (user.emailVerified) {
      this.log.debug("Email verification requested for already verified user", {
        email,
        userId: user.id,
      });
      return true;
    }

    try {
      const verification =
        await this.verificationController.requestVerificationCode({
          params: { type: method },
          body: { target: email },
        });

      if (method === "link") {
        // Build verification URL with token
        const url = new URL(verifyUrl || "/verify-email", "http://localhost");
        url.searchParams.set("email", email);
        url.searchParams.set("token", verification.token);
        const fullVerifyUrl = verifyUrl
          ? `${verifyUrl}${url.search}`
          : url.pathname + url.search;

        await this.userNotifications.emailVerificationLink.push({
          contact: email,
          variables: {
            email,
            verifyUrl: fullVerifyUrl,
            expiresInMinutes: Math.floor(verification.codeExpiration / 60),
          },
        });

        this.log.debug("Email verification link sent", {
          email,
          userId: user.id,
        });
      } else {
        await this.userNotifications.emailVerification.push({
          contact: email,
          variables: {
            email,
            code: verification.token,
            expiresInMinutes: Math.floor(verification.codeExpiration / 60),
          },
        });

        this.log.debug("Email verification code sent", {
          email,
          userId: user.id,
        });
      }
    } catch (error) {
      // Silent fail for security
      this.log.warn("Failed to send email verification", { email, error });
    }

    return true;
  }

  /**
   * Verify a user's email using a valid verification token.
   * Supports both code (6-digit) and link (UUID) verification tokens.
   */
  public async verifyEmail(
    email: string,
    token: string,
    userRealmName?: string,
  ): Promise<void> {
    this.log.trace("Verifying email", { email, userRealmName });

    // Detect verification type based on token format
    // Codes are 6-digit numbers, links are UUIDs
    const isCode = /^\d{6}$/.test(token);
    const type = isCode ? "code" : "link";

    const result = await this.verificationController
      .validateVerificationCode({
        params: { type },
        body: { target: email, token },
      })
      .catch(() => {
        this.log.warn("Invalid email verification token", { email, type });
        throw new BadRequestError("Invalid or expired verification token");
      });

    if (result.alreadyVerified) {
      this.log.warn("Email verification token already used", { email });
      throw new BadRequestError("Invalid or expired verification token");
    }

    const user = await this.users(userRealmName).findOne({
      where: { email: { eq: email } },
    });

    await this.users(userRealmName).updateById(user.id, {
      emailVerified: true,
    });

    this.log.info("Email verified", { email, userId: user.id, type });
  }

  /**
   * Check if an email is verified.
   */
  public async isEmailVerified(
    email: string,
    userRealmName?: string,
  ): Promise<boolean> {
    this.log.trace("Checking if email is verified", { email, userRealmName });

    const user = await this.users(userRealmName)
      .findOne({
        where: { email: { eq: email } },
      })
      .catch(() => undefined);

    return user?.emailVerified ?? false;
  }

  /**
   * Find users with pagination and filtering.
   */
  public async findUsers(
    q: UserQuery = {},
    userRealmName?: string,
  ): Promise<Page<UserEntity>> {
    this.log.trace("Finding users", { query: q, userRealmName });
    q.sort ??= "-createdAt";

    const where = this.users(userRealmName).createQueryWhere();

    if (q.email) {
      where.email = { like: q.email };
    }

    if (q.enabled !== undefined) {
      where.enabled = { eq: q.enabled };
    }

    if (q.emailVerified !== undefined) {
      where.emailVerified = { eq: q.emailVerified };
    }

    if (q.roles) {
      where.roles = { arrayContains: q.roles };
    }

    if (q.query) {
      Object.assign(where, parseQueryString(q.query));
    }

    const result = await this.users(userRealmName).paginate(
      q,
      { where },
      { count: true },
    );

    this.log.debug("Users found", {
      count: result.content.length,
      total: result.page.totalElements,
    });

    return result;
  }

  /**
   * Get a user by ID.
   */
  public async getUserById(
    id: string,
    userRealmName?: string,
  ): Promise<UserEntity> {
    this.log.trace("Getting user by ID", { id, userRealmName });
    return await this.users(userRealmName).findById(id);
  }

  /**
   * Create a new user.
   */
  public async createUser(
    data: CreateUser,
    userRealmName?: string,
  ): Promise<UserEntity> {
    this.log.trace("Creating user", {
      username: data.username,
      email: data.email,
      userRealmName,
    });

    // TODO: one query instead of 3

    // Check for existing user based on provided unique fields
    if (data.username) {
      const existingUser = await this.users(userRealmName)
        .findOne({
          where: { username: { eq: data.username } },
        })
        .catch(() => undefined);

      if (existingUser) {
        this.log.debug("Username already taken", { username: data.username });
        throw new BadRequestError("User with this username already exists");
      }
    }

    if (data.email) {
      const existingUser = await this.users(userRealmName)
        .findOne({
          where: { email: { eq: data.email } },
        })
        .catch(() => undefined);

      if (existingUser) {
        this.log.debug("Email already taken", { email: data.email });
        throw new BadRequestError("User with this email already exists");
      }
    }

    if (data.phoneNumber) {
      const existingUser = await this.users(userRealmName)
        .findOne({
          where: { phoneNumber: { eq: data.phoneNumber } },
        })
        .catch(() => undefined);

      if (existingUser) {
        this.log.debug("Phone number already taken", {
          phoneNumber: data.phoneNumber,
        });
        throw new BadRequestError("User with this phone number already exists");
      }
    }

    const user = await this.users(userRealmName).create({
      ...data,
      roles: data.roles ?? ["user"], // TODO: Default roles from realm settings
    });

    this.log.info("User created", {
      userId: user.id,
      username: user.username,
      email: user.email,
    });

    return user;
  }

  /**
   * Update an existing user.
   */
  public async updateUser(
    id: string,
    data: UpdateUser,
    userRealmName?: string,
  ): Promise<UserEntity> {
    this.log.trace("Updating user", { id, userRealmName });
    await this.getUserById(id, userRealmName);

    const user = await this.users(userRealmName).updateById(id, data);
    this.log.debug("User updated", { userId: id });
    return user;
  }

  /**
   * Delete a user by ID.
   */
  public async deleteUser(id: string, userRealmName?: string): Promise<void> {
    this.log.trace("Deleting user", { id, userRealmName });
    await this.getUserById(id, userRealmName);

    await this.users(userRealmName).deleteById(id);
    this.log.info("User deleted", { userId: id });
  }
}
