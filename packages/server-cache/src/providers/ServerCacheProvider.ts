import { createHash } from "node:crypto";
import { $cache, type CacheDescriptorOptions } from "@alepha/cache";
import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import { DateTimeProvider, type DurationLike } from "@alepha/datetime";
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
			}
		},
	});

	protected readonly onSend = $hook({
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

	protected createCacheKey(route: ServerRoute, args?: ServerRequest) {
		return `${route.method}:${route.path}:${args?.url?.href ?? "*"}`;
	}
}

export type ServerRouteCache =
	| boolean
	| DurationLike
	| Omit<CacheDescriptorOptions<any>, "handler" | "key">;

interface RouteCacheEntry {
	contentType?: string;
	body: string;
	status?: number;
	lastModified: string;
	hash: string;
}
