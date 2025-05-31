import { $hook, $inject, $logger, $retry, Alepha, OPTIONS } from "@alepha/core";
import { $remote, type RemoteDescriptor } from "../descriptors/$remote.ts";
import { HttpClient } from "../services/HttpClient.ts";
import { ProxyDescriptorProvider } from "./ProxyDescriptorProvider.ts";
import type { ServerRemote } from "./ServerActionDescriptorProvider.ts";

export class RemoteDescriptorProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly client = $inject(HttpClient);
	protected readonly proxyProvider = $inject(ProxyDescriptorProvider);
	protected readonly remotes: Array<ServerRemote> = [];
	protected readonly log = $logger();

	public getRemotes() {
		return this.remotes;
	}

	public readonly configure = $hook({
		name: "configure",
		handler: async () => {
			const remotes = this.alepha.getDescriptorValues($remote);
			for (const { value, key } of remotes) {
				await this.registerRemote(value, key);
			}
		},
	});

	public readonly start = $hook({
		name: "start",
		handler: async () => {
			for (const remote of this.remotes) {
				const token =
					typeof remote.serviceAccount?.token === "function"
						? await remote.serviceAccount.token()
						: undefined;

				const links = await remote.links(token);

				for (const link of links) {
					this.client.pushLink({
						...link,
						host: remote.url,
						service: remote.name,
					});
				}
			}
		},
	});

	public async registerRemote(value: RemoteDescriptor, key: string) {
		const options = value[OPTIONS];
		const url = typeof options.url === "string" ? options.url : options.url();
		const linkPath = options.linkPath ?? "/api/_links";
		const name = options.name ?? key;
		const proxy = typeof options.proxy === "object" ? options.proxy : {};

		this.remotes.push({
			url,
			name,
			serviceAccount: options.serviceAccount,
			proxy: !!options.proxy,
			links: async (authorization) => {
				return await this.fetchLinks(`${url}${linkPath}`, authorization);
			},
		});

		if (options.proxy) {
			await this.proxyProvider.proxy({
				path: `/api/${name}/*`,
				target: url,
				rewrite: (url) => {
					url.pathname = url.pathname.replace(`/api/${name}`, "/api");
				},
				...proxy,
			});
		}
	}

	protected readonly fetchLinks = $retry({
		max: 10,
		delay: 2000,
		onError: (_, attempt) => {
			this.log.warn(`Failed to fetch links, retry (${attempt})...`);
		},
		handler: async (url: string, authorization?: string) => {
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

			const links = await response.json();
			if (!Array.isArray(links)) {
				throw new Error(
					`Invalid response from ${url}: ${JSON.stringify(links)}`,
				);
			}

			return links;
		},
	});
}
