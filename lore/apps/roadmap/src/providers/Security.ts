import { $env, $inject, t } from "@alepha/core";
import { $auth } from "@alepha/react-auth";
import { $realm, CryptoProvider, type UserAccountInfo } from "@alepha/security";
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
				default: true,
				permissions: [{ name: "read:*" }],
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
			user: async (gg) => {
				return await this.db.users.findOne({
					email: { eq: gg.user.email },
				});
			},
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

				const user: UserAccountInfo = {
					id: res.id.toString(),
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
}

export default Security;
