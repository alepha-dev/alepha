import { $env, $hook, t } from "@alepha/core";
import { $auth } from "@alepha/react-auth";
import { $realm } from "@alepha/security";

class Security {
	env = $env(
		t.object({
			GOOGLE_CLIENT_ID: t.string(),
			GOOGLE_CLIENT_SECRET: t.string(),
			ADMIN_USER_ID: t.string(),
		}),
	);

	onCreateUser = $hook({
		on: "security:user:created",
		handler: ({ user }) => {
			if (user.id === this.env.ADMIN_USER_ID) {
				user.roles ??= [];
				user.roles.push("admin");
			}
		},
	});

	realm = $realm({
		name: "roadmap",
		secret: () => this.battleNet.jwks(),
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
	});

	battleNet = $auth({
		oidc: {
			issuer: "https://accounts.google.com",
			clientId: this.env.GOOGLE_CLIENT_ID,
			clientSecret: this.env.GOOGLE_CLIENT_SECRET,
			useIdToken: true,
		},
	});

	// gh = $auth({
	// 	disabled: true,
	// 	oauth: {
	// 		clientId: this.env.GITHUB_CLIENT_ID,
	// 		clientSecret: this.env.GITHUB_CLIENT_SECRET,
	// 		authorization: "https://github.com/login/oauth/authorize",
	// 		token: "https://github.com/login/oauth/access_token",
	// 		scope: "read:user user:email",
	// 		user: async (tokens) => {
	// 			const BASE_URL = "https://api.github.com";
	// 			const res = await fetch(`${BASE_URL}/user`, {
	// 				headers: {
	// 					Authorization: `Bearer ${tokens.access_token}`,
	// 					"User-Agent": "Alepha",
	// 				},
	// 			}).then((res) => res.json());
	//
	// 			const user: UserAccountInfo = {
	// 				id: res.id.toString(),
	// 			};
	//
	// 			if (res.email) {
	// 				user.email = res.email;
	// 			}
	//
	// 			if (res.name) {
	// 				user.name = res.name.trim();
	// 			}
	//
	// 			if (res.avatar_url) {
	// 				user.picture = res.avatar_url;
	// 			}
	//
	// 			if (!user.email) {
	// 				const res = await fetch(`${BASE_URL}/user/emails`, {
	// 					headers: {
	// 						Authorization: `Bearer ${tokens.access_token}`,
	// 						"User-Agent": "Alepha",
	// 					},
	// 				});
	// 				if (res.ok) {
	// 					const emails: any[] = await res.json();
	// 					user.email = (emails.find((e) => e.primary) ?? emails[0]).email;
	// 				}
	// 			}
	//
	// 			return user;
	// 		},
	// 	},
	// });
}

export default Security;
