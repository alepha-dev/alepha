import { $inject, Alepha, t } from "@alepha/core";
import {
	type Permission,
	SecurityProvider,
	type UserAccountToken,
} from "@alepha/security";
import { $route } from "../../descriptors/$route.ts";
import {
	type ApiLink,
	type ApiLinksResponse,
	apiLinksResponseSchema,
} from "../../schemas/apiLinksResponseSchema.ts";
import { HttpClient } from "../../services/HttpClient.ts";
import { RemoteDescriptorProvider } from "../RemoteDescriptorProvider.ts";
import { ServerActionDescriptorProvider } from "../ServerActionDescriptorProvider.ts";

export class ServerLinksProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly client = $inject(HttpClient);
	protected readonly remoteProvider = $inject(RemoteDescriptorProvider);
	protected readonly serverActionDescriptorProvider = $inject(
		ServerActionDescriptorProvider,
	);

	public readonly links = $route({
		path: "/api/_links",
		schema: {
			query: t.object({
				withSchema: t.optional(t.boolean()),
			}),
			response: apiLinksResponseSchema,
		},
		handler: async ({ user, headers, query }) => {
			return this.getLinks({
				user,
				authorization: headers.authorization,
				withSchema: query.withSchema,
			});
		},
	});

	public async getLinks(options: {
		user?: UserAccountToken;
		authorization?: string;
		withSchema?: boolean;
	}): Promise<ApiLinksResponse> {
		const { user } = options;
		let permissions: Permission[] | undefined;
		const hasSecurity = this.alepha.has(SecurityProvider);
		if (hasSecurity && user) {
			permissions = this.alepha.get(SecurityProvider).getPermissions(user);
		}

		const appLinks = this.client.links ?? [];
		const userLinks: ApiLink[] = [];

		for (const link of appLinks) {
			if (link.host) continue;
			if (hasSecurity && link.secured) {
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

			userLinks.push({
				...link,
				schema: options.withSchema ? link.schema : undefined,
			});
		}

		userLinks.push(
			...(
				await Promise.all(
					this.remoteProvider
						.getRemotes()
						.filter((it) => it.proxy) // add only "proxy" remotes
						.map(async (remote) => {
							const { links, prefix } = await remote.links(options);
							return links.map((link) => {
								let path = link.path.replace(prefix ?? "/api", "");
								if (link.service) {
									path = `/${link.service}${path}`;
								}

								return {
									...link,
									path,
									proxy: true,
									service: remote.name,
								};
							});
						}),
				)
			).flat(),
		);

		return {
			// userId: user?.id, why? this is not needed and not secure
			prefix: this.serverActionDescriptorProvider.getPrefix(),
			links: userLinks,
		};
	}
}
