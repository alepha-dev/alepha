import { $env, $hook, t } from "@alepha/core";
import { $auth } from "@alepha/react-auth";
import { $realm } from "@alepha/security";

export class Sec {
	env = $env(
		t.object({
			GOOGLE_CLIENT_ID: t.string(),
			GOOGLE_CLIENT_SECRET: t.string(),
			ADMIN_USER_ID: t.string(),
		}),
	);

	google = $auth({
		oidc: {
			issuer: "https://accounts.google.com",
			clientId: this.env.GOOGLE_CLIENT_ID,
			clientSecret: this.env.GOOGLE_CLIENT_SECRET,
			useIdToken: true,
		},
	});

	users = $realm({
		jwks: () => this.google.jwks_uri,
		roles: [
			{
				name: "admin",
				permissions: [{ name: "*" }],
			},
		],
	});

	onUserLoaded = $hook({
		on: "security:user:created",
		handler: ({ user }) => {
			if (user.id === this.env.ADMIN_USER_ID) {
				user.roles ??= [];
				user.roles.push("admin");
			}
		},
	});
}
