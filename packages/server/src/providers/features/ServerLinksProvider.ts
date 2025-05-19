import { $inject, Alepha, t } from "@alepha/core";
import { type Permission, SecurityProvider } from "@alepha/security";
import { $action } from "../../descriptors/$action.ts";
import { type HttpLink, httpLinkSchema } from "../../schemas/httpLinkSchema.ts";
import { HttpClient } from "../../services/HttpClient.ts";

export class ServerLinksProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly client = $inject(HttpClient);

	public readonly links = $action({
		path: "/_links",
		group: "system",
		schema: {
			response: t.array(httpLinkSchema, {
				maxItems: 1000,
			}),
		},
		internal: true,
		security: false,
		handler: async ({ user }) => {
			let permissions: Permission[] | undefined;
			const hasSecurity = this.alepha.has(SecurityProvider);
			if (hasSecurity) {
				const security = this.alepha.get(SecurityProvider);
				permissions = security.getPermissions(user);
			}

			const appLinks = await this.client.getLinks();
			const userLinks: HttpLink[] = [];

			for (const link of appLinks) {
				if (link.proxy === false) continue;
				if (hasSecurity && link.protected && permissions) {
					if (
						!permissions.some(
							(permission) =>
								permission.name === link.name &&
								permission.group === link.group,
						)
					) {
						continue;
					}
				}

				const { proxy, ...rest } = link;

				userLinks.push(rest);
			}

			return userLinks;
		},
	});
}
