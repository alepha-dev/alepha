import { $inject, Alepha, t } from "@alepha/core";
import { SecurityProvider } from "@alepha/security";
import { $route, type RouteMethod } from "../descriptors/$route";
import { HttpClient } from "../services/HttpClient";

export interface HttpLink {
	name: string;
	method?: RouteMethod;
	url?: string;
	group?: string;
}

export class ServerLinksProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly client = $inject(HttpClient);

	public readonly links = $route({
		url: "/_links",
		group: "system",
		schema: {
			response: t.array(
				t.object({
					name: t.string(),
					group: t.optional(t.string()),
					method: t.optional(t.string()),
					url: t.optional(t.string()),
				}),
			),
		},
		security: false,
		handler: async ({ user }) => {
			if (this.alepha.has(SecurityProvider)) {
				const security = this.alepha.get(SecurityProvider);
				if (user) {
					return security.getPermissions(user);
				}
				return this.client.links?.filter((link) => !link.protected) ?? [];
			}

			return this.client.links ?? [];
		},
	});
}
