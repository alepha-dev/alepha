import { createHash } from "node:crypto";
import {
	type Cache,
	type CacheDescriptorOptions,
	CacheDescriptorProvider,
} from "@alepha/cache";
import { $hook, $inject, $logger, OPTIONS } from "@alepha/core";
import {
	DateTimeProvider,
	type DurationLike,
	isDurationLike,
} from "@alepha/datetime";
import type {
	ServerHandler,
	ServerRequestConfig,
} from "../ServerRouterProvider.ts";

export class ServerCacheProvider {
	protected readonly log = $logger();
	protected readonly cacheProvider = $inject(CacheDescriptorProvider);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly caches = new Map<ServerHandler, RouteCache>();

	public readonly onRoute = $hook({
		name: "server:onRoute",
		handler: async ({ route }) => {
			if (!route.cache) {
				return;
			}

			const cache = this.cacheProvider.register({
				group: `${route.method}:${route.path}`,
				options: {
					provider: "memory",
					key: (args: any) => this.createCacheKey(args),
					...(typeof route.cache === "boolean"
						? {
								ttl: { minutes: 5 },
							}
						: isDurationLike(route.cache)
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
			// - buffer is not supported by @alepha/cache
			// - caching binary data like images can be problematic (memory usage, etc.)

			if (typeof response.body === "string") {
				const etag = this.generateETag(response.body);
				await this.cacheProvider.set(cache, key, {
					body: response.body,
					contentType: response.headers?.["content-type"],
					lastModified: this.dateTimeProvider.toISOString(),
					hash: etag,
				});
				response.headers ??= {};
				response.headers.etag = etag;
			} else {
				this.log.warn(
					`Response body for route ${route.method} ${route.path} is not a string, caching skipped.`,
				);
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
