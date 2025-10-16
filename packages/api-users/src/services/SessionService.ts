import { $inject, Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $repository } from "@alepha/postgres";
import type { OAuth2Profile } from "@alepha/react-auth";
import { CryptoProvider, type UserAccount } from "@alepha/security";
import { type ServerRequest, UnauthorizedError } from "@alepha/server";
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
}
