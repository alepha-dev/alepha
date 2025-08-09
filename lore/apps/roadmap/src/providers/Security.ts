import { $env, $inject, t } from "@alepha/core";
import { $auth, type OAuth2UserInfo } from "@alepha/react-auth";
import { $realm, CryptoProvider } from "@alepha/security";
import { UnauthorizedError } from "@alepha/server";
import { Db } from "./Db.ts";

class Security {
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
				],
			},
			{
				name: "admin",
				permissions: [{ name: "*" }],
			},
		],
		settings: {
			accessToken: {
				expiration: [30, "minutes"],
			},
			refreshToken: {
				expiration: [60, "days"],
			},
		},
	});

	db = $inject(Db);

	usernamePassword = $auth({
		realm: this.realm,
		credentials: {
			user: async (it) => {
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
			user: ({ user }) => this.link("google", user),
		},
	});

	//
	github = $auth({
		realm: this.realm,
		oauth: {
			clientId: this.env.GITHUB_CLIENT_ID,
			clientSecret: this.env.GITHUB_CLIENT_SECRET,
			authorization: "https://github.com/login/oauth/authorize",
			token: "https://github.com/login/oauth/access_token",
			scope: "read:user user:email",
			user: async (tokens) => {
				const BASE_URL = "https://api.github.com";
				const res = await fetch(`${BASE_URL}/user`, {
					headers: {
						Authorization: `Bearer ${tokens.access_token}`,
						"User-Agent": "Alepha",
					},
				}).then((res) => res.json());

				const user: OAuth2UserInfo = {
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

				return await this.db.users.findOne({
					email: { eq: user.email },
				});
			},
		},
	});

	protected async link(provider: string, userInfo: OAuth2UserInfo) {
		const identity = await this.db.identities
			.findOne({
				provider: { eq: provider },
				providerUserId: { eq: userInfo.sub },
			})
			.catch(() => undefined);

		if (identity) {
			// actually, we should fetch user from first SQL query,
			// but @alepha/postgres is not ready for that yet
			return this.db.users.findOne({
				id: { eq: identity.userId },
			});
		}

		if (!userInfo.email) {
			return {
				id: userInfo.sub,
				...userInfo,
			};
		}

		const existing = await this.db.users
			.findOne({
				email: { eq: userInfo.email },
			})
			.catch(() => undefined);

		if (existing) {
			await this.db.identities.create({
				provider: provider,
				providerUserId: userInfo.sub,
				userId: existing.id,
			});
			return existing;
		}

		const newUser = await this.db.users.create({
			email: userInfo.email,
			name: userInfo.name,
			picture: userInfo.picture,
			roles: ["user"],
		});

		await this.db.identities.create({
			provider: provider,
			providerUserId: userInfo.sub,
			userId: newUser.id,
		});

		return newUser;
	}
}

export default Security;
