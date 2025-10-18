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
	 * Generates a secure token and stores it with an expiration time.
	 *
	 * @param email - User's email address
	 * @param expiresInMinutes - Token expiration time in minutes (default: 60)
	 * @returns The reset token
	 */
	public async requestPasswordReset(
		email: string,
		expiresInMinutes = 60,
	): Promise<string> {
		// Find user by email
		const user = await this.users
			.findOne({
				where: { email: { eq: email } },
			})
			.catch(() => {
				// Don't reveal if the email exists or not for security
				// Return success but don't actually send email
				return undefined;
			});

		if (!user) {
			// Silent fail - don't reveal that email doesn't exist
			return "";
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
			return "";
		}

		// Generate secure reset token
		const resetToken = this.cryptoProvider.randomUUID();

		// Calculate expiration time
		const expiresAt = this.dateTimeProvider
			.now()
			.add(expiresInMinutes, "minutes")
			.toISOString();

		// Store token and expiration
		await this.identities.updateById(identity.id, {
			resetToken,
			resetTokenExpiresAt: expiresAt,
		});

		return resetToken;
	}

	/**
	 * Validate a password reset token.
	 */
	public async validateResetToken(token: string): Promise<string> {
		const identity = await this.identities.findOne({
			where: {
				resetToken: { eq: token },
			},
		});

		// Check if token has expired
		const now = this.dateTimeProvider.now();
		const expiresAt = identity.resetTokenExpiresAt
			? this.dateTimeProvider.of(identity.resetTokenExpiresAt)
			: null;

		if (!expiresAt || expiresAt < now) {
			throw new BadRequestError("Invalid or expired reset token");
		}

		// Get user email
		const user = await this.users.findOne({
			where: { id: { eq: identity.userId } },
		});

		return user.email;
	}

	/**
	 * Reset a user's password using a valid reset token.
	 */
	public async resetPassword(
		token: string,
		newPassword: string,
	): Promise<void> {
		// Validate token and get identity
		const identity = await this.identities
			.findOne({
				where: {
					resetToken: { eq: token },
				},
			})
			.catch(() => {
				throw new BadRequestError("Invalid or expired reset token");
			});

		// Check if token has expired
		const now = this.dateTimeProvider.now();
		const expiresAt = identity.resetTokenExpiresAt
			? this.dateTimeProvider.of(identity.resetTokenExpiresAt)
			: undefined;

		if (!expiresAt || expiresAt < now) {
			throw new BadRequestError("Invalid or expired reset token");
		}

		// Hash the new password
		const hashedPassword = await this.cryptoProvider.hashPassword(newPassword);

		// Update the identity with new password and clear reset token
		await this.identities.updateById(identity.id, {
			providerData: {
				...(identity.providerData as Record<string, unknown>),
				password: hashedPassword,
			},
			resetToken: null,
			resetTokenExpiresAt: null,
		});

		// Invalidate all existing sessions for this user
		await this.sessions.deleteMany({
			userId: { eq: identity.userId },
		});
	}
}
