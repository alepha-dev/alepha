import { VerificationController } from "@alepha/api-verifications";
import { $inject, Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $repository } from "@alepha/postgres";
import type { OAuth2Profile } from "@alepha/react-auth";
import { CryptoProvider, type UserAccount } from "@alepha/security";
import {
	BadRequestError,
	type ServerRequest,
	UnauthorizedError,
} from "@alepha/server";
import { identities } from "../entities/identities.ts";
import { sessions } from "../entities/sessions.ts";
import { users } from "../entities/users.ts";

export class SessionService {
	protected readonly alepha = $inject(Alepha);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly cryptoProvider = $inject(CryptoProvider);
	protected readonly verificationController = $inject(VerificationController);

	public readonly users = $repository(users);
	public readonly sessions = $repository(sessions);
	public readonly identities = $repository(identities);

	public async login(provider: string, username: string, password: string) {
		const identity = await this.identities.findOne({
			where: {
				provider: { eq: provider },
				providerUserId: { eq: username },
			},
		});

		const valid = await this.cryptoProvider.verifyPassword(
			password,
			identity.providerData?.password,
		);

		if (!valid) {
			throw new UnauthorizedError("Invalid credentials");
		}

		return await this.users.findOne({
			where: {
				id: { eq: identity.userId },
			},
		});
	}

	public async createSession(user: UserAccount, expiresIn: number) {
		const request = this.alepha.context.get<ServerRequest>("request");
		const refreshToken = this.cryptoProvider.randomUUID();

		const expiresAt = this.dateTimeProvider
			.now()
			.add(expiresIn, "seconds")
			.toISOString();

		const session = await this.sessions.create({
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

	public async refreshSession(refreshToken: string) {
		const session = await this.sessions.findOne({
			where: {
				refreshToken: { eq: refreshToken },
			},
		});

		const now = this.dateTimeProvider.now();
		const expiresAt = this.dateTimeProvider.of(session.expiresAt);

		if (this.dateTimeProvider.of(session.expiresAt) < now) {
			await this.sessions.deleteById(refreshToken);
			throw new UnauthorizedError("Session expired");
		}

		const user = await this.users.findOne({
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

	public async deleteSession(refreshToken: string) {
		await this.sessions.deleteOne({
			refreshToken,
		});
	}

	public async link(provider: string, profile: OAuth2Profile) {
		const identity = await this.identities
			.findOne({
				where: {
					provider,
					providerUserId: profile.sub,
				},
			})
			.catch(() => undefined);

		if (identity) {
			return this.users.findOne({
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

		const existing = await this.users
			.findOne({
				where: {
					email: profile.email,
				},
			})
			.catch(() => undefined);

		if (existing) {
			await this.identities.create({
				provider,
				providerUserId: profile.sub,
				userId: existing.id,
			});
			return existing;
		}

		const newUser = await this.users.create({
			email: profile.email,
			name: profile.name,
			picture: profile.picture,
			roles: ["user"],
		});

		await this.identities.create({
			provider,
			providerUserId: profile.sub,
			userId: newUser.id,
		});

		return newUser;
	}

	/**
	 * Request a password reset for a user by email.
	 * Uses the verification service for secure token generation and management.
	 *
	 * @param email - User's email address
	 * @param resetUrl - Base URL for the password reset page
	 * @returns True if reset was initiated (regardless of whether user exists - for security)
	 */
	public async requestPasswordReset(
		email: string,
		resetUrl: string,
	): Promise<boolean> {
		// Find user by email (silent fail for security)
		const user = await this.users
			.findOne({
				where: { email: { eq: email } },
			})
			.catch(() => undefined);

		if (!user) {
			// Silent fail - don't reveal that email doesn't exist
			return true;
		}

		// Find the credentials identity for this user
		const identity = await this.identities
			.findOne({
				where: {
					userId: { eq: user.id },
					provider: { eq: "credentials" },
				},
			})
			.catch(() => undefined);

		if (!identity) {
			// User doesn't have credentials identity (maybe OAuth only)
			// Silent fail - don't reveal this information
			return true;
		}

		// Create verification using verification service
		// This handles: token generation, expiration, rate limiting, cooldown
		try {
			await this.verificationController.requestVerificationCode({
				params: { type: "email" },
				body: { target: email, verifyUrl: resetUrl },
			});
		} catch {
			// If rate limit or cooldown hit, still return true for security
			// The error will be logged but not exposed to user
		}

		return true;
	}

	/**
	 * Validate a password reset token.
	 * Returns email if valid, throws error if invalid/expired.
	 */
	public async validateResetToken(
		email: string,
		token: string,
	): Promise<string> {
		// Verify using verification service
		const isValid = await this.verificationController
			.validateVerificationCode({
				params: { type: "email" },
				body: { target: email, token },
			})
			.catch(() => undefined);

		if (!isValid?.ok) {
			throw new BadRequestError("Invalid or expired reset token");
		}

		return email;
	}

	/**
	 * Reset a user's password using a valid reset token.
	 * Validates token, updates password, and invalidates all sessions.
	 */
	public async resetPassword(
		email: string,
		token: string,
		newPassword: string,
	): Promise<void> {
		// Verify token using verification service
		const result = await this.verificationController
			.validateVerificationCode({
				params: { type: "email" },
				body: { target: email, token },
			})
			.catch(() => {
				throw new BadRequestError("Invalid or expired reset token");
			});

		// If already verified, this is a token reuse attempt
		if (result.alreadyVerified) {
			throw new BadRequestError("Invalid or expired reset token");
		}

		// Find user and identity
		const user = await this.users.findOne({
			where: { email: { eq: email } },
		});

		const identity = await this.identities.findOne({
			where: {
				userId: { eq: user.id },
				provider: { eq: "credentials" },
			},
		});

		// Hash the new password
		const hashedPassword = await this.cryptoProvider.hashPassword(newPassword);

		// Update the identity with new password
		await this.identities.updateById(identity.id, {
			providerData: {
				...(identity.providerData as Record<string, unknown>),
				password: hashedPassword,
			},
		});

		// Invalidate all existing sessions for this user
		await this.sessions.deleteMany({
			userId: { eq: user.id },
		});
	}
}
