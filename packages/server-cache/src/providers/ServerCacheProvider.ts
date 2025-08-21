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
		cache?: ServerRouteCache;
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
			if (!cache) {
				return;
			}

			const key = this.createCacheKey(action.route, request);
			const cached = await this.cache.get(key);
			if (cached) {
				const body =
					cached.contentType === "application/json"
						? JSON.parse(cached.body)
						: cached.body;

				this.log.trace("Cache hit for action", {
					key,
					action: action.name,
				});

				request.reply.body = body; // just re-use, full trust
			} else {
				this.log.trace("Cache miss for action", {
					key,
					action: action.name,
				});
			}
		},
	});

	protected readonly onActionResponse = $hook({
		on: "action:onResponse",
		handler: async ({ action, request, response }) => {
			const cache = action.route.cache;
			if (!cache || !response) {
				return;
			}

			const key = this.createCacheKey(action.route, request);

			// TODO: serialize the response body, exactly like in the server response hook
			// this is bad
			const contentType =
				typeof response === "string" ? "text/plain" : "application/json";
			const body =
				contentType === "text/plain" ? response : JSON.stringify(response);

			const etag = this.generateETag(body);

			this.log.trace("Caching action", {
				key,
				action: action.name,
				length: body.length,
			});

			await this.cache.set(key, {
				body: body,
				lastModified: this.time.toISOString(),
				contentType: contentType,
				hash: etag,
			});
		},
	});

	protected readonly onRequest = $hook({
		on: "server:onRequest",
		handler: async ({ route, request }) => {
			const cache = route.cache;
			if (!cache) {
				return;
			}

			const key = this.createCacheKey(route, request);

			const cached = await this.cache.get(key);
			if (cached) {
				this.log.trace("Cache hit for route", {
					key,
					route: route.path,
				});

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
					request.reply.setHeader("Content-Type", cached.contentType);
				}
			} else {
				this.log.trace("Cache miss for route", {
					key,
					route: route.path,
				});
			}
		},
	});

	protected readonly onResponse = $hook({
		on: "server:onResponse",
		priority: "first",
		handler: async ({ route, request, response }) => {
			const cache = route.cache;
			if (!cache) {
				return;
			}

			const key = this.createCacheKey(route, request);

			// we only cache string responses (text, html, json, etc.)
			// - buffer is not supported by @alepha/cache, for now!

			if (typeof response.body === "string") {
				this.log.trace("Caching response", {
					key,
					route: route.path,
					status: response.status,
				});
				const etag = this.generateETag(response.body);
				await this.cache.set(key, {
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

	protected getCacheOptions(cache: ServerRouteCache) {
		if (typeof cache === "boolean") {
			return {
				ttl: this.time.duration(5, "minutes"),
			};
		}

		if (this.time.isDurationLike(cache)) {
			return {
				ttl: cache,
			};
		}

		return {
			...cache,
		};
	}

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
