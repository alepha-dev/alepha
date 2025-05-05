import type { DurationLike, Static } from "@alepha/core";
import {
	$hook,
	$inject,
	Alepha,
	DateTimeProvider,
	KIND,
	t,
} from "@alepha/core";
import type {
	CacheDescriptor,
	CacheDescriptorOptions,
} from "../descriptors/$cache.ts";
import { $cache } from "../descriptors/$cache.ts";
import { CacheProvider } from "./CacheProvider.ts";
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
	protected readonly cacheProvider = $inject(CacheProvider);
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

	public processDescriptors() {
		const caches = this.alepha.getDescriptorValues($cache);
		for (const { value, key, instance } of caches) {
			const { options } = value;
			const group = options.group ?? `${instance.constructor.name}:${key}`;
			const cache = { options, group };

			this.caches.push({ options, group });

			const $: CacheDescriptor = (...args) => this.run(cache, ...args);

			$[KIND] = value[KIND];
			$.options = value.options;

			$.key = (...args) => this.key(cache, ...args);
			$.invalidate = (...keys) => this.invalidate(cache, ...keys);
			$.set = (key, value, ttl) => this.set(cache, key, value, ttl);
			$.get = (key) => this.get(cache, key);

			instance[key] = $;
		}
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
	 *
	 * @param cache
	 * @param keys
	 */
	public async invalidate(cache: Cache, ...keys: string[]): Promise<void> {
		await this.provider(cache.options).del(cache.group, ...keys);
	}

	/**
	 *
	 */
	protected async run<TReturn, TParameter extends any[]>(
		cache: Cache<TReturn, TParameter>,
		...args: TParameter
	): Promise<TReturn> {
		const handler = cache.options.handler;
		if (!handler) {
			throw new Error("Cache handler is not defined.");
		}

		if (
			!this.alepha.isStarted() ||
			cache.options.disabled ||
			!this.env.CACHE_ENABLED
		) {
			return handler(...args);
		}

		const key = this.key(cache, ...args);

		const data = await this.get(cache, key);
		if (data) {
			return data;
		}

		const result = await handler(...args);
		// when exception occurs, we don't cache the result

		await this.set(cache, key, result, cache.options.ttl);

		return result;
	}

	public async get<TReturn>(
		cache: Cache<TReturn>,
		key: string,
	): Promise<TReturn | undefined> {
		const provider = this.provider(cache.options);

		const data = await provider.get(cache.group, key);
		if (data) {
			return JSON.parse(data);
		}

		return undefined;
	}

	public async set<TReturn>(
		cache: Cache<TReturn>,
		key: string,
		value: TReturn,
		ttl?: DurationLike,
	): Promise<void> {
		const px = this.dateTimeProvider
			.duration(
				ttl ?? cache.options.ttl ?? { seconds: this.env.CACHE_DEFAULT_TTL },
			)
			.as("milliseconds");

		await this.provider(cache.options).set(
			cache.group,
			key,
			JSON.stringify(value),
			px > 0 ? px : undefined,
		);
	}
}

export interface Cache<TReturn = any, TParameter extends any[] = any[]> {
	options: CacheDescriptorOptions<TReturn, TParameter>;
	group: string;
}
