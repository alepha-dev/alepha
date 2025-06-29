import { createHash } from "node:crypto";
import {
	type Cache,
	type CacheDescriptorOptions,
	CacheDescriptorProvider,
} from "@alepha/cache";
import { $hook, $inject, $logger, Alepha, OPTIONS } from "@alepha/core";
import { DateTimeProvider, type DurationLike } from "@alepha/datetime";
import {
	$action,
	type ServerHandler,
	type ServerRequestConfig,
} from "@alepha/server";

declare module "@alepha/server" {
	interface ServerRoute {
		cache?: ServiceRouteCache;
	}
	interface ActionDescriptor {
		invalidate: () => Promise<void>;
	}
}

export class ServerCacheProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly cacheProvider = $inject(CacheDescriptorProvider);
	protected readonly time = $inject(DateTimeProvider);
	protected readonly caches = new Map<ServerHandler, RouteCache>();

	public readonly onConfigure = $hook({
		priority: "last",
		name: "configure",
		handler: async () => {
			const actions = this.alepha.getDescriptorValues($action);
			for (const { value: action } of actions) {
				action.invalidate = async () => {
					await this.invalidate(action);
				};
			}
		},
	});

	public readonly onRoute = $hook({
		name: "server:onRoute",
		handler: async ({ route }) => {
			if (!route.cache) {
				return;
			}

			const cache = this.cacheProvider.register({
				name: `${route.method}:${route.path}`,
				options: {
					provider: "memory",
					key: (args: any) => this.createCacheKey(args),
					...(typeof route.cache === "boolean"
						? {
								ttl: this.time.duration(5, "minutes"),
							}
						: this.time.isDurationLike(route.cache)
							? {
									ttl: route.cache,
								}
							: {
									...route.cache,
								}),
				},
			});

			this.caches.set(route.handler, cache);
		},
	});

	public readonly onRequest = $hook({
		name: "server:onRequest",
		handler: async ({ route, request }) => {
			const cache = this.getCacheByRoute(route);
			if (!cache) {
				return;
			}

			const key = this.createCacheKey(request);
			const cached = await this.cacheProvider.get(cache, key);
			if (cached) {
				// if user has already the resource cached, just return 304 Not Modified
				if (
					request.headers["if-none-match"] === cached.hash ||
					request.headers["if-modified-since"] === cached.lastModified
				) {
					request.reply.status = 304;
					return;
				}

				// if the cache is found, we can skip the request processing
				// and return the cached response
				request.reply.body = cached.body;
				request.reply.status = cached.status ?? 200;
				if (cached.contentType) {
					request.reply.headers ??= {};
					request.reply.headers["content-type"] = cached.contentType;
				}
			}
		},
	});

	public readonly onSend = $hook({
		name: "server:onResponse",
		priority: "first",
		handler: async ({ route, request, response }) => {
			const cache = this.getCacheByRoute(route);
			if (!cache) {
				return;
			}

			const key = this.createCacheKey(request);

			// we only cache string responses (text, html, json, etc.)
			// - buffer is not supported by @alepha/cache, for now!

			if (typeof response.body === "string") {
				const etag = this.generateETag(response.body);
				await this.cacheProvider.set(cache, key, {
					body: response.body,
					status: response.status,
					contentType: response.headers?.["content-type"],
					lastModified: this.time.toISOString(),
					hash: etag,
				});
				response.headers ??= {};
				response.headers.etag = etag;
			}
		},
	});

	public generateETag(content: string): string {
		return `"${createHash("md5").update(content).digest("hex")}"`;
	}

	public async invalidate(route: RouteLike) {
		const cache = this.getCacheByRoute(route);
		if (!cache) {
			return;
		}

		await this.cacheProvider.invalidate(cache);
	}

	protected getCacheByRoute(route: RouteLike): RouteCache | undefined {
		const options = OPTIONS in route ? route[OPTIONS] : route;
		if (!options.handler) {
			return;
		}

		return this.caches.get(options.handler);
	}

	protected createCacheKey(args: ServerRequestConfig) {
		return JSON.stringify({
			query: args.query ?? {},
			params: args.params ?? {},
			body: args.body ?? {},
		});
	}
}

export type ServiceRouteCache =
	| boolean
	| DurationLike
	| Omit<CacheDescriptorOptions<any>, "handler" | "key">;

type RouteCache = Cache<{
	contentType?: string;
	body: string;
	status?: number;
	lastModified: string;
	hash: string;
}>;

type RouteLike =
	| {
			[OPTIONS]: {
				handler?: ServerHandler;
			};
	  }
	| {
			handler?: ServerHandler;
	  };
