import { $inject, $logger, type Static, t } from "@alepha/core";
import { $sequence } from "@alepha/postgres";
import { $auth } from "@alepha/react";
import { $realm } from "@alepha/security";
import { $route as $action, $cookie } from "@alepha/server";
import { Service } from "./Service.ts";

export const incResponse = t.object({
	type: t.string(),
	count: t.number(),
	v: t.number(),
});

export type IncResponse = Static<typeof incResponse>;

class Api {
	seq = $sequence();

	env = $inject(
		t.object({
			KEYCLOAK_URL: t.string({
				default: "https://keycloak.sdser.online",
			}),
			KEYCLOAK_REALM: t.string({
				default: "customers",
			}),
		}),
	);

	srv = $inject(Service);

	auth = $auth({
		oidc: {
			issuer: `${this.env.KEYCLOAK_URL}/realms/${this.env.KEYCLOAK_REALM}`,
			clientId: "sds-ui-shop",
		},
	});

	realm = $realm({
		secret: `${this.env.KEYCLOAK_URL}/realms/${this.env.KEYCLOAK_REALM}/protocol/openid-connect/certs`,
		roles: [
			{
				name: "sds:customer",
				permissions: [
					{
						name: "*",
					},
				],
			},
		],
	});

	hi = $action({
		schema: {
			response: incResponse,
		},
		handler: async () => {
			return {
				type: "hi",
				count: 0,
				v: 0,
			};
		},
	});

	v = $cookie({
		name: "zzz",
		schema: t.number(),
	});

	inc = $action({
		schema: {
			response: incResponse,
		},
		handler: async ({ cookies }) => {
			let v = this.v.get(cookies) ?? 0;
			await this.hello();
			v += 1;
			this.v.set(cookies, v);
			return {
				type: "inc",
				count: await this.seq.next(),
				v,
			};
		},
	});

	log = $logger();

	async hello() {
		this.log.info("Hello from Api", {
			hello: {
				name: "world",
			},
		});
		await this.srv.printLog();
	}
}

export default Api;
