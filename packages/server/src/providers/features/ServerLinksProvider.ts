import { $inject, Alepha, t } from "@alepha/core";
import { type Permission, SecurityProvider } from "@alepha/security";
import { $action } from "../../descriptors/$action.ts";
import { type HttpLink, httpLinkSchema } from "../../schemas/httpLinkSchema.ts";
import { HttpClient } from "../../services/HttpClient.ts";
import { RemoteDescriptorProvider } from "../RemoteDescriptorProvider.ts";

export class ServerLinksProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly client = $inject(HttpClient);
	protected readonly remoteProvider = $inject(RemoteDescriptorProvider);

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
		handler: async ({ user, headers }) => {
			let permissions: Permission[] | undefined;
			const hasSecurity = this.alepha.has(SecurityProvider);
			if (hasSecurity && user) {
				permissions = this.alepha.get(SecurityProvider).getPermissions(user);
			}

			const appLinks = await this.client.getLinks();
			const userLinks: HttpLink[] = [];

			for (const link of appLinks) {
				if (link.host) continue;
				if (hasSecurity && link.protected) {
					if (!user) {
						continue;
					}

					if (permissions) {
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
				}

				userLinks.push(link);
			}

			userLinks.push(
				...(
					await Promise.all(
						this.remoteProvider.getRemotes().map(async (remote) => {
							const links = await remote.links(headers.authorization);
							return links.map((link) => ({
								...link,
								path: link.path.replace("/api", `/api/${remote.name}`),
								proxy: true,
								service: remote.name,
							}));
						}),
					)
				).flat(),
			);

			return userLinks;
		},
	});
}
