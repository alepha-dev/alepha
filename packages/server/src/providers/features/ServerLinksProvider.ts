import { $inject, Alepha, t } from "@alepha/core";
import { SecurityProvider } from "@alepha/security";
import { $action } from "../../descriptors/$action.ts";
import { httpLinkSchema } from "../../schemas/httpLinkSchema.ts";
import { HttpClient } from "../../services/HttpClient.ts";

export class ServerLinksProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly client = $inject(HttpClient);

	public readonly links = $action({
		path: "/_links",
		group: "system",
		schema: {
			response: t.array(httpLinkSchema),
		},
		internal: true,
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
