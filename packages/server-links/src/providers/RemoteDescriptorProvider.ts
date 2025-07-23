import {
	$hook,
	$inject,
	$logger,
	Alepha,
	type Logger,
	OPTIONS,
} from "@alepha/core";
import { $retry, type RetryDescriptor } from "@alepha/retry";
import type { ServiceAccountDescriptor } from "@alepha/security";
import { type ApiLinksResponse, apiLinksResponseSchema } from "@alepha/server";
import { ProxyDescriptorProvider } from "@alepha/server-proxy";
import { $remote, type RemoteDescriptor } from "../descriptors/$remote.ts";
import { LinkProvider } from "./LinkProvider.ts";

export class RemoteDescriptorProvider {
	static path = {
		apiLinks: "/api/_links",
	};

	protected readonly alepha = $inject(Alepha);
	protected readonly client: LinkProvider = $inject(LinkProvider);
	protected readonly proxyProvider = $inject(ProxyDescriptorProvider);
	protected readonly remotes: Array<ServerRemote> = [];
	protected readonly log: Logger = $logger();

	public getRemotes(): ServerRemote[] {
		return this.remotes;
	}

	public readonly configure = $hook({
		on: "configure",
		handler: async () => {
			const remotes = this.alepha.getDescriptorValues($remote);
			for (const { value, key } of remotes) {
				await this.registerRemote(value, key);
			}
		},
	});

	public readonly start = $hook({
		on: "start",
		handler: async () => {
			for (const remote of this.remotes) {
				const token =
					typeof remote.serviceAccount?.token === "function"
						? await remote.serviceAccount.token()
						: undefined;

				if (!remote.internal) {
					continue; // skip download links for remotes that are not internal
				}

				const { links } = await remote.links({ authorization: token });

				for (const link of links) {
					let path = link.path.replace(remote.prefix, "");
					if (link.service) {
						path = `/${link.service}${path}`;
					}

					this.client.pushLink({
						...link,
						prefix: remote.prefix,
						path,
						method: link.method ?? "GET",
						host: remote.url,
						service: remote.name,
					});
				}

				this.log.info("Remote links OK", {
					service: remote.name,
					links: remote.links,
					prefix: remote.prefix,
				});
			}
		},
	});

	public async registerRemote(
		value: RemoteDescriptor,
		key: string,
	): Promise<void> {
		const options = value[OPTIONS];
		const url = typeof options.url === "string" ? options.url : options.url();
		const linkPath = RemoteDescriptorProvider.path.apiLinks;
		const name = options.name ?? key;
		const proxy = typeof options.proxy === "object" ? options.proxy : {};

		const remote: ServerRemote = {
			url,
			name,
			prefix: "/api",
			serviceAccount: options.serviceAccount,
			proxy: !!options.proxy,
			internal: !proxy.noInternal,
			schema: async (opts) => {
				const { authorization, name } = opts;
				return await fetch(`${url}${linkPath}/${name}/schema`, {
					headers: new Headers(
						authorization
							? {
									authorization,
								}
							: {},
					),
				}).then((it) => it.json()); // TODO: use schema validation for response
			},
			links: async (opts) => {
				const { authorization } = opts;
				const response = await this.fetchLinks({
					service: name,
					url: `${url}${linkPath}`,
					authorization,
				});

				if (response.prefix != null) {
					remote.prefix = response.prefix;
				}

				return response;
			},
		};

		this.remotes.push(remote);

		if (options.proxy) {
			await this.proxyProvider.proxy({
				path: `/api/${name}/*`,
				target: url,
				rewrite: (url) => {
					url.pathname = url.pathname.replace(`/api/${name}`, remote.prefix);
				},
				...proxy,
			});
		}
	}

	protected readonly fetchLinks: RetryDescriptor<
		(opts: FetchLinksOptions) => Promise<ApiLinksResponse>
	> = $retry({
		max: 10,
		backoff: {
			initial: 1000,
		},
		onError: (_, attempt, { service, url }) => {
			this.log.warn(`Failed to fetch links, retry (${attempt})...`, {
				service,
				url,
			});
		},
		handler: async (opts: FetchLinksOptions): Promise<ApiLinksResponse> => {
			const { url, authorization } = opts;
			const response = await fetch(url, {
				headers: new Headers(
					authorization
						? {
								authorization,
							}
						: {},
				),
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch links from ${url}`);
			}

			return this.alepha.parse(apiLinksResponseSchema, await response.json());
		},
	});
}

export interface FetchLinksOptions {
	service: string;
	url: string;
	authorization?: string;
}

export interface ServerRemote {
	url: string;
	name: string;
	proxy: boolean;
	internal: boolean;
	links: (args: { authorization?: string }) => Promise<ApiLinksResponse>;
	schema: (args: { name: string; authorization?: string }) => Promise<any>;
	serviceAccount?: ServiceAccountDescriptor;
	prefix: string;
}
