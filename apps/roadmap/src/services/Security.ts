import { $env, t } from "@alepha/core";
import { $auth } from "@alepha/react-auth";
import { $realm, type UserAccountInfo } from "@alepha/security";

class Security {
	env = $env(
		t.object({
			GITHUB_CLIENT_ID: t.string(),
			GITHUB_CLIENT_SECRET: t.string(),
			BATTLE_NET_CLIENT_ID: t.string(),
			BATTLE_NET_CLIENT_SECRET: t.string(),
		}),
	);

	realm = $realm({
		name: "roadmap",
		secret: () => this.battleNet.jwks(),
		roles: [
			{
				name: "user",
				default: true,
				permissions: [{ name: "*" }], // Full access
			},
		],
		profile: (payload) => {
			return {
				id: payload.sub,
				name: payload.battle_tag,
			};
		},
	});

	battleNet = $auth({
		oidc: {
			useIdToken: true,
			issuer: "https://oauth.battle.net",
			clientId: this.env.BATTLE_NET_CLIENT_ID,
			clientSecret: this.env.BATTLE_NET_CLIENT_SECRET,
			scope: "openid",
			logoutUri: "https://battle.net/login/logout",
		},
		profile: (payload) => {
			return {
				id: payload.sub,
				name: payload.battle_tag,
			};
		},
	});

	gh = $auth({
		disabled: true,
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

				return user;
			},
		},
	});
}

export default Security;
