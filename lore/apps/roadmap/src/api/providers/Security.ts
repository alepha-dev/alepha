import { $env, $inject, Alepha, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $auth, type OAuth2Profile } from "@alepha/react-auth";
import { $realm, CryptoProvider, type UserAccount } from "@alepha/security";
import { type ServerRequest, UnauthorizedError } from "@alepha/server";
import { Db } from "./Db.ts";

export class Security {
	dateTimeProvider = $inject(DateTimeProvider);
	alepha = $inject(Alepha);
	crypto = $inject(CryptoProvider);
	env = $env(
		t.object({
			APP_SECRET: t.string(),
			GOOGLE_CLIENT_ID: t.string(),
			GOOGLE_CLIENT_SECRET: t.string(),
			GITHUB_CLIENT_ID: t.string(),
			GITHUB_CLIENT_SECRET: t.string(),
		}),
	);

	realm = $realm({
		name: "roadmap",
		secret: this.env.APP_SECRET,
		roles: [
			{
				name: "user",
				permissions: [
					{
						name: "TaskApi:*",
						ownership: true,
					},
					{
						name: "ProjectApi:*",
						ownership: true,
					},
					{
						name: "UserApi:*",
						ownership: true,
					},
					{
						name: "SessionApi:*",
						ownership: true,
					},
				],
			},
			{
				name: "admin",
				permissions: [{ name: "*" }],
			},
		],
		settings: {
			accessToken: {
				expiration: [15, "minutes"],
			},
			refreshToken: {
				expiration: [7, "days"], // for testing 7 days, but we will go with +30 days later
			},
			onCreateSession: async (user, config) => {
				return this.createSession(user, config.expiresIn);
			},
			onRefreshSession: async (refreshToken) => {
				return this.refreshSession(refreshToken);
			},
			onDeleteSession: async (refreshToken) => {
				await this.db.sessions.deleteMany({
					refreshToken,
				});
			},
		},
	});

	async refreshSession(refreshToken: string) {
		const session = await this.db.sessions.findOne({
			refreshToken: { eq: refreshToken },
		});

		const now = this.dateTimeProvider.now();
		const expiresAt = this.dateTimeProvider.of(session.expiresAt);

		if (this.dateTimeProvider.of(session.expiresAt) < now) {
			await this.db.sessions.deleteById(refreshToken);
			throw new UnauthorizedError("Session expired");
		}

		const user = await this.db.users.findOne({
			id: { eq: session.userId },
		});

		return {
			user,
			expiresIn: expiresAt.unix() - now.unix(),
			sessionId: session.id,
		};
	}

	async createSession(user: UserAccount, expiresIn: number) {
		const request = this.alepha.context.get<ServerRequest>("request");

		const refreshToken = crypto.randomUUID();

		const expiresAt = this.dateTimeProvider
			.now()
			.add(expiresIn, "seconds")
			.toISOString();

		const session = await this.db.sessions.create({
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

	db = $inject(Db);

	usernamePassword = $auth({
		realm: this.realm,
		credentials: {
			account: async (it) => {
				const identity = await this.db.identities.findOne({
					provider: { eq: "usernamePassword" },
					providerUserId: { eq: it.username },
				});

				const valid = await this.crypto.verifyPassword(
					it.password,
					identity.providerData?.password,
				);

				if (!valid) {
					throw new UnauthorizedError("Invalid credentials");
				}

				return await this.db.users.findOne({
					id: { eq: identity.userId },
				});
			},
		},
	});

	google = $auth({
		realm: this.realm,
		oidc: {
			issuer: "https://accounts.google.com",
			clientId: this.env.GOOGLE_CLIENT_ID,
			clientSecret: this.env.GOOGLE_CLIENT_SECRET,
			account: ({ user }) => this.link("google", user),
		},
	});

	github = $auth({
		realm: this.realm,
		oauth: {
			clientId: this.env.GITHUB_CLIENT_ID,
			clientSecret: this.env.GITHUB_CLIENT_SECRET,
			authorization: "https://github.com/login/oauth/authorize",
			token: "https://github.com/login/oauth/access_token",
			scope: "read:user user:email",
			userinfo: async (tokens) => {
				const BASE_URL = "https://api.github.com";
				const res = await fetch(`${BASE_URL}/user`, {
					headers: {
						Authorization: `Bearer ${tokens.access_token}`,
						"User-Agent": "Alepha",
					},
				}).then((res) => res.json());

				const user: OAuth2Profile = {
					sub: res.id.toString(),
				};

				if (res.email) {
					user.email = res.email;
				}

				if (res.name) {
					user.name = res.name.trim();
				}

				if (res.avatar_url) {
					user.picture = res.avatar_url;
				}

				if (!user.email) {
					const res = await fetch(`${BASE_URL}/user/emails`, {
						headers: {
							Authorization: `Bearer ${tokens.access_token}`,
							"User-Agent": "Alepha",
						},
					});
					if (res.ok) {
						const emails: any[] = await res.json();
						user.email = (emails.find((e) => e.primary) ?? emails[0]).email;
					}
				}

				return user;
			},
			account: ({ user }) => this.link("github", user),
		},
	});

	protected async link(provider: string, profile: OAuth2Profile) {
		const identity = await this.db.identities
			.findOne({
				provider,
				providerUserId: profile.sub,
			})
			.catch(() => undefined);

		if (identity) {
			return this.db.users.findOne({
				id: identity.userId,
			});
		}

		if (!profile.email) {
			return {
				id: profile.sub,
				...profile,
			};
		}

		const existing = await this.db.users
			.findOne({
				email: profile.email,
			})
			.catch(() => undefined);

		if (existing) {
			await this.db.identities.create({
				provider,
				providerUserId: profile.sub,
				userId: existing.id,
			});
			return existing;
		}

		const newUser = await this.db.users.create({
			email: profile.email,
			name: profile.name,
			picture: profile.picture,
			roles: ["user"],
		});

		await this.db.identities.create({
			provider,
			providerUserId: profile.sub,
			userId: newUser.id,
		});

		return newUser;
	}
}
