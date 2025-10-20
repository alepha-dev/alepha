import type { VerificationController } from "@alepha/api-verifications";
import { $inject } from "@alepha/core";
import { $repository, type Page } from "@alepha/postgres";
import { BadRequestError } from "@alepha/server";
import { $client } from "@alepha/server-links";
import type { UserEntity } from "../entities/users.ts";
import { users } from "../entities/users.ts";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import type { CreateUser } from "../schemas/createUserSchema.ts";
import type { UpdateUser } from "../schemas/updateUserSchema.ts";
import type { UserQuery } from "../schemas/userQuerySchema.ts";

export class UserService {
	protected readonly verificationController = $client<VerificationController>();
	protected readonly userNotifications = $inject(UserNotifications);

	public readonly users = $repository(users);

	/**
	 * Request email verification for a user.
	 * Uses the verification service for secure token generation and management.
	 *
	 * @param email - User's email address
	 * @param verifyUrl - Base URL for the email verification page
	 * @returns True if verification was initiated
	 */
	public async requestEmailVerification(
		email: string,
		verifyUrl: string,
	): Promise<boolean> {
		// Find user by email
		const user = await this.users
			.findOne({
				where: { email: { eq: email } },
			})
			.catch(() => undefined);

		if (!user) {
			// Silent fail - don't reveal that email doesn't exist
			return true;
		}

		if (user.emailVerified) {
			// Email already verified, silent fail
			return true;
		}

		// Create verification using verification controller
		// This handles: token generation, expiration, rate limiting, cooldown
		try {
			const verification =
				await this.verificationController.requestVerificationCode({
					params: { type: "email" },
					body: { target: email },
				});

			// Send email verification notification with the token
			const verifyUrlWithToken = `${verifyUrl}?token=${verification.token}`;
			await this.userNotifications.emailVerification.push({
				contact: email,
				variables: {
					email,
					verifyUrl: verifyUrlWithToken,
					expiresInMinutes: Math.floor(verification.codeExpiration / 60),
				},
			});
		} catch {
			// If rate limit or cooldown hit, still return true for security
			// The error will be logged but not exposed to user
		}

		return true;
	}

	/**
	 * Verify a user's email using a valid verification token.
	 * Validates token and updates the user's emailVerified status.
	 */
	public async verifyEmail(email: string, token: string): Promise<void> {
		// Verify token using verification controller
		const result = await this.verificationController
			.validateVerificationCode({
				params: { type: "email" },
				body: { target: email, token },
			})
			.catch(() => {
				throw new BadRequestError("Invalid or expired verification token");
			});

		// If already verified, this is a token reuse attempt
		if (result.alreadyVerified) {
			throw new BadRequestError("Invalid or expired verification token");
		}

		// Find user
		const user = await this.users.findOne({
			where: { email: { eq: email } },
		});

		// Update emailVerified status
		await this.users.updateById(user.id, {
			emailVerified: true,
		});
	}

	/**
	 * Check if an email is verified.
	 *
	 * @param email - User's email address
	 * @returns True if email is verified, false otherwise
	 */
	public async isEmailVerified(email: string): Promise<boolean> {
		const user = await this.users
			.findOne({
				where: { email: { eq: email } },
			})
			.catch(() => undefined);

		return user?.emailVerified ?? false;
	}

	/**
	 * Find users with pagination and filtering.
	 */
	public async findUsers(q: UserQuery = {}): Promise<Page<UserEntity>> {
		q.sort ??= "-createdAt";

		const where = this.users.createQueryWhere();

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

		return await this.users.paginate(q, { where }, { count: true });
	}

	/**
	 * Get a user by ID.
	 */
	public async getUserById(id: string): Promise<UserEntity> {
		return await this.users.findById(id);
	}

	/**
	 * Create a new user.
	 */
	public async createUser(data: CreateUser): Promise<UserEntity> {
		// Check if email already exists
		const existingUser = await this.users
			.findOne({
				where: { email: { eq: data.email } },
			})
			.catch(() => undefined);

		if (existingUser) {
			throw new BadRequestError("User with this email already exists");
		}

		return await this.users.create({
			...data,
			roles: data.roles ?? ["user"],
		});
	}

	/**
	 * Update an existing user.
	 */
	public async updateUser(id: string, data: UpdateUser): Promise<UserEntity> {
		// Verify user exists
		await this.getUserById(id);

		return await this.users.updateById(id, data);
	}

	/**
	 * Delete a user by ID.
	 */
	public async deleteUser(id: string): Promise<void> {
		// Verify user exists
		await this.getUserById(id);

		await this.users.deleteById(id);
	}
}
