import { $inject, Alepha } from "alepha";
import type { VerificationController } from "alepha/api/verifications";
import { $logger } from "alepha/logger";
import type { Page } from "alepha/orm";
import { BadRequestError } from "alepha/server";
import { $client } from "alepha/server/links";
import { UserAudits } from "../audits/UserAudits.ts";
import type { UserEntity } from "../entities/users.ts";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import type { CreateUser } from "../schemas/createUserSchema.ts";
import type { UpdateUser } from "../schemas/updateUserSchema.ts";
import type { UserQuery } from "../schemas/userQuerySchema.ts";

export class UserService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly verificationController = $client<VerificationController>();
  protected readonly realmProvider = $inject(RealmProvider);

  protected userAudits(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    if (realm.features.audits) {
      return this.alepha.inject(UserAudits);
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
  ): Promise<boolean> {
    this.log.trace("Requesting email verification", {
      email,
      userRealmName,
      method,
    });

    const user = await this.users(userRealmName).findOne({
      where: { email: { eq: email } },
    });

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
        // Build verification URL from realm settings (server-controlled, not user input)
        const realm = this.realmProvider.getRealm(userRealmName);
        const realmSettings = await realm.getSettings();
        const baseUrl = realmSettings.verifyEmailUrl ?? "/verify-email";
        const url = new URL(baseUrl, "http://localhost");
        url.searchParams.set("email", email);
        url.searchParams.set("token", verification.token);
        const fullVerifyUrl = realmSettings.verifyEmailUrl
          ? `${baseUrl}${url.search}`
          : url.pathname + url.search;

        await this.userNotifications(userRealmName)?.emailVerificationLink.push(
          {
            contact: email,
            variables: {
              email,
              verifyUrl: fullVerifyUrl,
              expiresInMinutes: Math.floor(verification.codeExpiration / 60),
            },
          },
        );

        this.log.debug("Email verification link sent", {
          email,
          userId: user.id,
        });
      } else {
        await this.userNotifications(userRealmName)?.emailVerification.push({
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

    const user = await this.users(userRealmName).getOne({
      where: { email: { eq: email } },
    });

    await this.users(userRealmName).updateById(user.id, {
      emailVerified: true,
    });

    this.log.info("Email verified", { email, userId: user.id, type });

    const realm = this.realmProvider.getRealm(userRealmName);

    await this.userAudits(userRealmName)?.recordUser("update", {
      userId: user.id,
      userEmail: email,
      userRealm: realm.name,
      resourceId: user.id,
      description: "Email verified",
      metadata: { email, verificationType: type },
    });
  }

  /**
   * Check if an email is verified.
   */
  public async isEmailVerified(
    email: string,
    userRealmName?: string,
  ): Promise<boolean> {
    this.log.trace("Checking if email is verified", { email, userRealmName });

    const user = await this.users(userRealmName).findOne({
      where: { email: { eq: email } },
    });

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
    return await this.users(userRealmName).getById(id);
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

    const realm = this.realmProvider.getRealm(userRealmName);
    const realmSettings = await realm.getSettings();

    // Check for existing user based on provided unique fields (scoped to realm)
    if (data.username) {
      const existingUser = await this.users(userRealmName).findOne({
        where: { realm: realm.name, username: { ilike: data.username } },
      });

      if (existingUser) {
        this.log.debug("Username already taken", { username: data.username });
        throw new BadRequestError("User with this username already exists");
      }
    }

    if (data.email) {
      const existingUser = await this.users(userRealmName).findOne({
        where: { realm: realm.name, email: { eq: data.email } },
      });

      if (existingUser) {
        this.log.debug("Email already taken", { email: data.email });
        throw new BadRequestError("User with this email already exists");
      }
    }

    if (data.phoneNumber) {
      const existingUser = await this.users(userRealmName).findOne({
        where: { realm: realm.name, phoneNumber: { eq: data.phoneNumber } },
      });

      if (existingUser) {
        this.log.debug("Phone number already taken", {
          phoneNumber: data.phoneNumber,
        });
        throw new BadRequestError("User with this phone number already exists");
      }
    }

    const user = await this.users(userRealmName).create({
      ...data,
      roles: data.roles ?? realmSettings.defaultRoles,
      realm: realm.name,
    });

    this.log.info("User created", {
      userId: user.id,
      username: user.username,
      email: user.email,
    });

    await this.userAudits(userRealmName)?.recordUser("create", {
      userRealm: realm.name,
      resourceId: user.id,
      description: "User created",
      metadata: {
        username: user.username,
        email: user.email,
        roles: user.roles,
      },
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
    const before = await this.getUserById(id, userRealmName);

    const user = await this.users(userRealmName).updateById(id, data);
    this.log.debug("User updated", { userId: id });

    const realm = this.realmProvider.getRealm(userRealmName);

    // Build changes object showing what was updated
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(data) as (keyof UpdateUser)[]) {
      if (data[key] !== undefined && before[key] !== data[key]) {
        changes[key] = { from: before[key], to: data[key] };
      }
    }

    // Detect role changes for special handling
    const isRoleChange =
      data.roles !== undefined &&
      JSON.stringify(before.roles) !== JSON.stringify(data.roles);

    await this.userAudits(userRealmName)?.recordUser(
      isRoleChange ? "role_change" : "update",
      {
        userRealm: realm.name,
        resourceId: user.id,
        description: isRoleChange
          ? "User roles changed"
          : `User updated: ${Object.keys(changes).join(", ")}`,
        metadata: { changes },
      },
    );

    return user;
  }

  /**
   * Delete a user by ID.
   */
  public async deleteUser(id: string, userRealmName?: string): Promise<void> {
    this.log.trace("Deleting user", { id, userRealmName });
    const user = await this.getUserById(id, userRealmName);

    // Clean up related sessions and identities before deleting the user
    await this.realmProvider
      .sessionRepository(userRealmName)
      .deleteMany({ userId: { eq: id } });
    await this.realmProvider
      .identityRepository(userRealmName)
      .deleteMany({ userId: { eq: id } });

    await this.users(userRealmName).deleteById(id);
    this.log.info("User deleted", { userId: id });

    const realm = this.realmProvider.getRealm(userRealmName);

    await this.userAudits(userRealmName)?.recordUser("delete", {
      userRealm: realm.name,
      resourceId: id,
      severity: "warning",
      description: "User deleted",
      metadata: {
        username: user.username,
        email: user.email,
      },
    });
  }
}
