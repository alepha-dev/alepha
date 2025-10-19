import { VerificationController } from "@alepha/api-verifications";
import { $inject } from "@alepha/core";
import { $repository } from "@alepha/postgres";
import { BadRequestError } from "@alepha/server";
import { users } from "../entities/users.ts";

export class UserService {
	protected readonly verificationController = $inject(VerificationController);

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

		// Create verification using verification service
		// This handles: token generation, expiration, rate limiting, cooldown
		try {
			await this.verificationController.requestVerificationCode({
				params: { type: "email" },
				body: { target: email, verifyUrl },
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
		// Verify token using verification service
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
}
