import { $inject, $logger, type Static, t } from "@alepha/core";
import { $sequence } from "@alepha/postgres";
import { $auth } from "@alepha/react-auth";
import { $realm } from "@alepha/security";
import { $route as $action } from "@alepha/server";
import { $cookie } from "@alepha/server-cookies";
import { $swagger } from "@alepha/server-swagger";
import { DummyService } from "../services/DummyService.ts";

export const incResponse = t.object(
	{
		type: t.string({
			description: "The type of the response.",
		}),
		count: t.uint({
			description: "The current count.",
		}),
		v: t.uint(),
	},
	{
		title: "IncResponse",
		description: "A short description about this resource.",
	},
);

export type IncResponse = Static<typeof incResponse>;

class Api {
	seq = $sequence();

	env = $inject(
		t.object({
			KEYCLOAK_URL: t.string({
				default: "https://keycloak.sdser.online",
			}),
			KEYCLOAK_REALM: t.string({
				default: "agents",
			}),
			KEYCLOAK_CLIENT_ID: t.string({
				default: "sds-ui-admin",
			}),
		}),
	);

	docs = $swagger({
		prefix: "/docs",
		info: {
			title: "Api",
			version: "1.0.0",
			description: "Api description",
		},
		ui: {
			initOAuth: {
				realm: this.env.KEYCLOAK_REALM,
				clientId: this.env.KEYCLOAK_CLIENT_ID,
				usePkceWithAuthorizationCodeGrant: true,
			},
		},
		rewrite: (doc) => {
			doc.components ??= {};
			doc.components.securitySchemes = {
				bearerAuth: {
					type: "openIdConnect",
					openIdConnectUrl: `${this.env.KEYCLOAK_URL}/realms/${this.env.KEYCLOAK_REALM}/.well-known/openid-configuration`,
				},
			};
		},
	});

	srv = $inject(DummyService);

	auth = $auth({
		oidc: {
			issuer: `${this.env.KEYCLOAK_URL}/realms/${this.env.KEYCLOAK_REALM}`,
			clientId: this.env.KEYCLOAK_CLIENT_ID,
		},
	});

	realm = $realm({
		secret: `${this.env.KEYCLOAK_URL}/realms/${this.env.KEYCLOAK_REALM}/protocol/openid-connect/certs`,
		roles: [
			{
				name: "sds:admin",
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
