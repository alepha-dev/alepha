import { $hook, $inject, Alepha, t } from "@alepha/core";
import {
	type Permission,
	SecurityProvider,
	type UserAccountToken,
} from "@alepha/security";
import {
	$action,
	$route,
	type ApiLink,
	type ApiLinksResponse,
	apiLinksResponseSchema,
	type ClientRequestEntry,
	type ClientRequestOptions,
	type RequestConfigSchema,
} from "@alepha/server";
import { LinkProvider } from "./LinkProvider.ts";
import { RemoteDescriptorProvider } from "./RemoteDescriptorProvider.ts";

export class ServerLinksProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly client = $inject(LinkProvider);
	protected readonly remoteProvider = $inject(RemoteDescriptorProvider);

	public readonly onRoute = $hook({
		on: "configure",
		handler: () => {
			for (const action of this.alepha.descriptors($action)) {
				this.client.pushLink({
					name: action.name,
					group: action.group,
					schema: action.options.schema,
					requestBodyType: action.getBodyContentType(),
					secured: action.options.secure !== false,
					method: action.method === "GET" ? undefined : action.method,
					prefix: action.prefix,
					path: action.path,
					handler: (
						config: ClientRequestEntry<RequestConfigSchema>,
						options: ClientRequestOptions = {},
					) => action.run(config, options),
				});
			}
		},
	});

	public readonly links = $route({
		path: RemoteDescriptorProvider.path.apiLinks,
		schema: {
			response: apiLinksResponseSchema,
		},
		handler: async ({ user, headers }) => {
			return this.getLinks({
				user,
				authorization: headers.authorization,
			});
		},
	});

	public readonly schema = $route({
		path: `${RemoteDescriptorProvider.path.apiLinks}/:name/schema`,
		schema: {
			params: t.object({
				name: t.string(),
			}),
			response: t.json(),
		},
		handler: async ({ params, user, headers }) => {
			const authorization = headers.authorization;
			const links = await this.getLinks({
				user,
				authorization,
			});

			for (const link of links.links) {
				if (link.name === params.name) {
					if (link.service) {
						// remote
						return this.remoteProvider
							.getRemotes()
							.find((it) => it.name === link.service)
							?.schema({ name: params.name, authorization });
					}
					// local
					return (
						this.client.links?.find((it) => it.name === params.name)?.schema ??
						{}
					);
				}
			}

			return {};
		},
	});

	public async getLinks(options: GetLinksOptions): Promise<ApiLinksResponse> {
		const { user } = options;
		let permissions: Permission[] | undefined;
		const hasSecurity = this.alepha.has(SecurityProvider);
		if (hasSecurity && user) {
			permissions = this.alepha.inject(SecurityProvider).getPermissions(user);
		}

		const appLinks = this.client.links ?? [];
		const userLinks: ApiLink[] = [];

		for (const permission of permissions ?? []) {
			if (!permission.path && !permission.method) {
				userLinks.push({
					path: "", // this is a placeholder for links without specific path
					...permission,
				});
			}
		}

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

			const { schema: _unused, ...copy } = link;
			userLinks.push(copy);
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
			prefix: this.client.links?.[0]?.prefix ?? "/api",
			links: userLinks,
		};
	}
}

export interface GetLinksOptions {
	user?: UserAccountToken;
	authorization?: string;
}
