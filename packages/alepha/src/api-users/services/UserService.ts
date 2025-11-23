import { $inject } from "alepha";
import type { VerificationController } from "alepha/api/verifications";
import type { Page } from "alepha/orm";
import { BadRequestError } from "alepha/server";
import { $client } from "alepha/server/links";
import type { UserEntity } from "../entities/users.ts";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";
import type { CreateUser } from "../schemas/createUserSchema.ts";
import type { UpdateUser } from "../schemas/updateUserSchema.ts";
import type { UserQuery } from "../schemas/userQuerySchema.ts";

export class UserService {
  protected readonly verificationController = $client<VerificationController>();
  protected readonly userNotifications = $inject(UserNotifications);
  protected readonly userRealmProvider = $inject(UserRealmProvider);

  public users(userRealmName?: string) {
    return this.userRealmProvider.userRepository(userRealmName);
  }

  /**
   * Request email verification for a user.
   */
  public async requestEmailVerification(
    email: string,
    userRealmName?: string,
  ): Promise<boolean> {
    const user = await this.users(userRealmName)
      .findOne({
        where: { email: { eq: email } },
      })
      .catch(() => undefined);

    if (!user) {
      return true;
    }

    if (user.emailVerified) {
      return true;
    }

    try {
      const verification =
        await this.verificationController.requestVerificationCode({
          params: { type: "code" },
          body: { target: email },
        });

      await this.userNotifications.emailVerification.push({
        contact: email,
        variables: {
          email,
          code: verification.token,
          expiresInMinutes: Math.floor(verification.codeExpiration / 60),
        },
      });
    } catch {
      // Silent fail for security
    }

    return true;
  }

  /**
   * Verify a user's email using a valid verification token.
   */
  public async verifyEmail(
    email: string,
    token: string,
    userRealmName?: string,
  ): Promise<void> {
    const result = await this.verificationController
      .validateVerificationCode({
        params: { type: "code" },
        body: { target: email, token },
      })
      .catch(() => {
        throw new BadRequestError("Invalid or expired verification token");
      });

    if (result.alreadyVerified) {
      throw new BadRequestError("Invalid or expired verification token");
    }

    const user = await this.users(userRealmName).findOne({
      where: { email: { eq: email } },
    });

    await this.users(userRealmName).updateById(user.id, {
      emailVerified: true,
    });
  }

  /**
   * Check if an email is verified.
   */
  public async isEmailVerified(
    email: string,
    userRealmName?: string,
  ): Promise<boolean> {
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

    return await this.users(userRealmName).paginate(
      q,
      { where },
      { count: true },
    );
  }

  /**
   * Get a user by ID.
   */
  public async getUserById(
    id: string,
    userRealmName?: string,
  ): Promise<UserEntity> {
    return await this.users(userRealmName).findById(id);
  }

  /**
   * Create a new user.
   */
  public async createUser(
    data: CreateUser,
    userRealmName?: string,
  ): Promise<UserEntity> {
    // TODO: one query instead of 3

    // Check for existing user based on provided unique fields
    if (data.username) {
      const existingUser = await this.users(userRealmName)
        .findOne({
          where: { username: { eq: data.username } },
        })
        .catch(() => undefined);

      if (existingUser) {
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
        throw new BadRequestError("User with this phone number already exists");
      }
    }

    return await this.users(userRealmName).create({
      ...data,
      roles: data.roles ?? ["user"], // TODO: Default roles from realm settings
    });
  }

  /**
   * Update an existing user.
   */
  public async updateUser(
    id: string,
    data: UpdateUser,
    userRealmName?: string,
  ): Promise<UserEntity> {
    await this.getUserById(id, userRealmName);

    return await this.users(userRealmName).updateById(id, data);
  }

  /**
   * Delete a user by ID.
   */
  public async deleteUser(id: string, userRealmName?: string): Promise<void> {
    await this.getUserById(id, userRealmName);

    await this.users(userRealmName).deleteById(id);
  }
}
