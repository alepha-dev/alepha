import {
	$hook,
	$inject,
	Alepha,
	KIND,
	OPTIONS,
	type Static,
	t,
} from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";
import { DateTimeProvider } from "@alepha/datetime";
import type {
	CacheDescriptor,
	CacheDescriptorOptions,
} from "../descriptors/$cache.ts";
import { $cache } from "../descriptors/$cache.ts";
import type { CacheProvider } from "../interfaces/CacheProvider.ts";
import { DefaultCacheProvider } from "./DefaultCacheProvider.ts";
import { MemoryCacheProvider } from "./MemoryCacheProvider.ts";

const envSchema = t.object({
	CACHE_DEFAULT_TTL: t.number({
		default: 300, // 5 minutes
		description: "The default time to live for cache entries. In seconds.",
	}),
	CACHE_PREFIX: t.optional(
		t.string({
			description: "Prefix store key",
		}),
	),
	CACHE_ENABLED: t.boolean({ default: true }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class CacheDescriptorProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly cacheProvider = $inject(DefaultCacheProvider);
	protected readonly memoryCacheProvider = $inject(MemoryCacheProvider);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly env = $inject(envSchema);
	protected readonly caches: Cache[] = [];

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			this.processDescriptors();
		},
	});

	public register(cache: Cache) {
		this.caches.push(cache);
		return cache;
	}

	public processDescriptors() {
		const caches = this.alepha.getDescriptorValues($cache);
		for (const { value, key, instance } of caches) {
			const { [OPTIONS]: options } = value;
			const group = options.group ?? `${instance.constructor.name}:${key}`;
			const cache = { options, group };

			this.caches.push(cache);

			const $: CacheDescriptor = (...args) => this.run(cache, ...args);

			$[KIND] = value[KIND];
			$[OPTIONS] = value[OPTIONS];

			$.key = (...args) => this.key(cache, ...args);
			$.invalidate = (...keys) => this.invalidate(cache, ...keys);
			$.set = (key, value, ttl) => this.set(cache, key, value, ttl);
			$.get = (key) => this.get(cache, key);

			instance[key] = $;
		}
	}

	public getCaches(): Cache[] {
		return this.caches;
	}

	/**
	 * Clear all cache entries.
	 */
	public async clear() {
		for (const cache of this.caches) {
			await this.invalidate(cache);
		}
	}

	/**
	 * Get the store provider for the given cache options.
	 *
	 * @param options
	 */
	public provider(
		options: Pick<CacheDescriptorOptions<any[], any>, "provider">,
	): CacheProvider {
		if (!options.provider) {
			return this.cacheProvider;
		}

		if (options.provider === "memory") {
			return this.memoryCacheProvider;
		}

		return options.provider();
	}

	/**
	 * Get the cache key for the given state and arguments.
	 */
	public key(cache: Cache, ...args: any[]) {
		return cache.options.key
			? cache.options.key(...args)
			: JSON.stringify(args);
	}

	/**
	 * Invalidate the cache for the given state and arguments.
	 */
	public async invalidate(cache: Cache, ...keys: string[]): Promise<void> {
		await this.provider(cache.options).del(cache.group, ...keys);
	}

	/**
	 * Run the cache handler with the given state and arguments.
	 * You must run on a $cache with a handler defined.
	 */
	public async run<TReturn, TParameter extends any[]>(
		cache: Cache<TReturn, TParameter>,
		...args: TParameter
	): Promise<TReturn> {
		const handler = cache.options.handler;
		if (!handler) {
			throw new Error("Cache handler is not defined.");
		}

		const key = this.key(cache, ...args);
		const cached = await this.get(cache, key);
		if (cached) {
			return cached;
		}

		const result = await handler(...args);
		// note: when exception occurs, don't cache the result

		await this.set(cache, key, result, cache.options.ttl);

		return result;
	}

	public async get<TReturn>(
		cache: Cache<TReturn>,
		key: string,
	): Promise<TReturn | undefined> {
		if (
			!this.alepha.isReady() ||
			cache.options.disabled ||
			!this.env.CACHE_ENABLED
		) {
			return undefined;
		}

		const provider = this.provider(cache.options);
		const data = await provider.get(cache.group, key);
		if (data) {
			return this.deserialize<TReturn>(data);
		}

		return undefined;
	}

	/**
	 * Manually set a value in the cache.
	 * It's used by .run() method, but you will need it when you don't have cache handler defined.
	 *
	 * @param cache Cache object with all configuration and options (even TTL).
	 * @param key Cache key, build with .key() method or manually.
	 * @param value Value to store in cache.
	 * @param ttl Override cache.ttl option.
	 */
	public async set<TReturn>(
		cache: Cache<TReturn>,
		key: string,
		value: TReturn,
		ttl?: DurationLike,
	): Promise<void> {
		const provider = this.provider(cache.options);
		const px = this.dateTimeProvider
			.duration(
				ttl ?? cache.options.ttl ?? [this.env.CACHE_DEFAULT_TTL, "seconds"],
			)
			.as("milliseconds");

		await provider.set(
			cache.group,
			key,
			this.serialize(value),
			px > 0 ? px : undefined,
		);
	}

	protected serialize<TReturn>(value: TReturn): string {
		return JSON.stringify(value);
	}

	protected deserialize<TReturn>(value: string): TReturn {
		return JSON.parse(value) as TReturn;
	}
}

export interface Cache<TReturn = any, TParameter extends any[] = any[]> {
	group: string;
	options: CacheDescriptorOptions<TReturn, TParameter>;
}
