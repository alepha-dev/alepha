import { createHash } from "node:crypto";
import { $cache, type CacheDescriptorOptions } from "@alepha/cache";
import { $hook, $inject, Alepha } from "@alepha/core";
import { DateTimeProvider, type DurationLike } from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import {
	ActionDescriptor,
	type RequestConfigSchema,
	type ServerRequest,
	type ServerRoute,
} from "@alepha/server";

declare module "@alepha/server" {
	interface ServerRoute {
		/**
		 * Enable caching for this route.
		 * If set to true, a default cache configuration will be applied (5 minutes TTL).
		 * If a DurationLike is provided, it will be used as the TTL for the cache.
		 *
		 * @default false
		 */
		cache?: ServerRouteCache;

		/**
		 * Enable ETag support for this route.
		 * If set to true, the server will generate and manage ETags automatically.
		 * If a string is provided, it will be used as a static ETag value.
		 *
		 * @default false
		 */
		etag?: boolean | string;
	}

	interface ActionDescriptor<TConfig extends RequestConfigSchema> {
		invalidate: () => Promise<void>;
	}
}

ActionDescriptor.prototype.invalidate = async function (
	this: ActionDescriptor<RequestConfigSchema>,
) {
	await this.alepha.inject(ServerCacheProvider).invalidate(this.route);
};

export class ServerCacheProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly time = $inject(DateTimeProvider);
	protected readonly cache = $cache<RouteCacheEntry>({
		provider: "memory",
	});

	public generateETag(content: string): string {
		return `"${createHash("md5").update(content).digest("hex")}"`;
	}

	public async invalidate(route: ServerRoute) {
		const cache = route.cache;
		if (!cache) {
			return;
		}

		await this.cache.invalidate(this.createCacheKey(route));
	}

	protected readonly onActionRequest = $hook({
		on: "action:onRequest",
		handler: async ({ action, request }) => {
			const cache = action.route.cache;
			const etag = action.route.etag;

			// Check for cached response or ETag
			if (cache || etag) {
				const key = this.createCacheKey(action.route, request);
				const cached = await this.cache.get(key);

				if (cached) {
					// Check if client has matching ETag - return 304 for both cached and etag-only routes
					if (
						request.headers["if-none-match"] === cached.hash ||
						request.headers["if-modified-since"] === cached.lastModified
					) {
						request.reply.status = 304;
						request.reply.body = "";
						request.reply.setHeader("etag", cached.hash);
						request.reply.setHeader("last-modified", cached.lastModified);
						this.log.trace("ETag match, returning 304", {
							action: action.name,
							etag: cached.hash,
						});
						return;
					}

					// Only serve cached content if caching is enabled (not for etag-only routes)
					if (cache) {
						const body =
							cached.contentType === "application/json"
								? JSON.parse(cached.body)
								: cached.body;

						this.log.trace("Cache hit for action", {
							key,
							action: action.name,
						});

						request.reply.body = body; // just re-use, full trust
						request.reply.setHeader("etag", cached.hash);
						request.reply.setHeader("last-modified", cached.lastModified);
					}
				} else if (cache) {
					this.log.trace("Cache miss for action", {
						key,
						action: action.name,
					});
				}
			}
		},
	});

	protected readonly onActionResponse = $hook({
		on: "action:onResponse",
		handler: async ({ action, request, response }) => {
			const cache = action.route.cache;
			const etag = action.route.etag;

			if ((!cache && !etag) || !response) {
				return;
			}

			// TODO: serialize the response body, exactly like in the server response hook
			// this is bad
			const contentType =
				typeof response === "string" ? "text/plain" : "application/json";
			const body =
				contentType === "text/plain" ? response : JSON.stringify(response);

			const generatedEtag = this.generateETag(body);
			const lastModified = this.time.toISOString();

			// Store response for both cached and etag-only routes
			const key = this.createCacheKey(action.route, request);

			this.log.trace("Storing response", {
				key,
				action: action.name,
				cache: !!cache,
				etag: !!etag,
			});

			await this.cache.set(key, {
				body: body,
				lastModified,
				contentType: contentType,
				hash: generatedEtag,
			});

			// Set ETag headers
			request.reply.setHeader("etag", generatedEtag);
			request.reply.setHeader("last-modified", lastModified);
		},
	});

	protected readonly onRequest = $hook({
		on: "server:onRequest",
		handler: async ({ route, request }) => {
			const cache = route.cache;
			const etag = route.etag;

			// Check for cached response or ETag
			if (!cache && !etag) {
				return;
			}

			const key = this.createCacheKey(route, request);
			const cached = await this.cache.get(key);

			if (cached) {
				// Check if client has matching ETag - return 304 for both cached and etag-only routes
				if (
					request.headers["if-none-match"] === cached.hash ||
					request.headers["if-modified-since"] === cached.lastModified
				) {
					request.reply.status = 304;
					request.reply.setHeader("etag", cached.hash);
					request.reply.setHeader("last-modified", cached.lastModified);
					this.log.trace("ETag match, returning 304", {
						route: route.path,
						etag: cached.hash,
					});
					return;
				}

				// Only serve cached content if caching is enabled (not for etag-only routes)
				if (cache) {
					this.log.trace("Cache hit for route", {
						key,
						route: route.path,
					});

					// if the cache is found, we can skip the request processing
					// and return the cached response
					request.reply.body = cached.body;
					request.reply.status = cached.status ?? 200;

					if (cached.contentType) {
						request.reply.setHeader("Content-Type", cached.contentType);
					}

					request.reply.setHeader("etag", cached.hash);
					request.reply.setHeader("last-modified", cached.lastModified);
				}
			} else if (cache) {
				this.log.trace("Cache miss for route", {
					key,
					route: route.path,
				});
			}
		},
	});

	protected readonly onSend = $hook({
		on: "server:onSend",
		handler: async ({ route, request }) => {
			// before sending the response, check if the ETag matches
			// and if so, return a 304 Not Modified response
			// -> this is only relevant for etag-only routes, not cached routes <-
			if (!route.cache && route.etag && request.reply.body != null) {
				const generatedEtag = this.generateETag(request.reply.body);

				if (request.headers["if-none-match"] === generatedEtag) {
					request.reply.status = 304;
					request.reply.body = undefined;
					request.reply.setHeader("etag", generatedEtag);
					this.log.trace("ETag match on send, returning 304", {
						route: route.path,
						etag: generatedEtag,
					});
					return;
				}
			}
		},
	});

	protected readonly onResponse = $hook({
		on: "server:onResponse",
		priority: "first",
		handler: async ({ route, request, response }) => {
			const cache = route.cache;
			const etag = route.etag;

			// Skip if neither cache nor etag is enabled
			if (!cache && !etag) {
				return;
			}

			// Only process string responses (text, html, json, etc.)
			// Buffer is not supported by @alepha/cache for now
			if (typeof response.body !== "string") {
				return;
			}

			const key = this.createCacheKey(route, request);
			const generatedEtag = this.generateETag(response.body);
			const lastModified = this.time.toISOString();

			// Initialize headers if not present
			response.headers ??= {};

			// Store response for both cached and etag-only routes
			this.log.trace("Storing response", {
				key,
				route: route.path,
				cache: !!cache,
				etag: !!etag,
			});

			if (cache) {
				await this.cache.set(key, {
					body: response.body,
					status: response.status,
					contentType: response.headers?.["content-type"],
					lastModified,
					hash: generatedEtag,
				});
			}

			// Set ETag headers
			response.headers.etag = generatedEtag;
			response.headers["last-modified"] = lastModified;
		},
	});

	protected createCacheKey(route: ServerRoute, config?: ServerRequest): string {
		const params: string[] = [];
		for (const [key, value] of Object.entries(config?.params ?? {})) {
			params.push(`${key}=${value}`);
		}
		for (const [key, value] of Object.entries(config?.query ?? {})) {
			params.push(`${key}=${value}`);
		}

		return `${route.method}:${route.path.replaceAll(":", "")}:${params.join(",").replaceAll(":", "")}`;
	}
}

export type ServerRouteCache =
	| boolean
	| DurationLike
	| Omit<CacheDescriptorOptions<any>, "handler" | "key">;

interface RouteCacheEntry {
	contentType?: string;
	body: any;
	status?: number;
	lastModified: string;
	hash: string;
}
