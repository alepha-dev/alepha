import {
	$env,
	$hook,
	$inject,
	Alepha,
	KIND,
	OPTIONS,
	type Static,
	type TBoolean,
	type TNumber,
	type TObject,
	type TOptional,
	type TString,
	t,
} from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";
import { DateTimeProvider } from "@alepha/datetime";
import type {
	CacheDescriptor,
	CacheDescriptorOptions,
} from "../descriptors/$cache.ts";
import { $cache } from "../descriptors/$cache.ts";
import { CacheError } from "../errors/CacheError.ts";
import { CacheProvider } from "./CacheProvider.ts";
import { MemoryCacheProvider } from "./MemoryCacheProvider.ts";

const envSchema: TObject<{
	CACHE_DEFAULT_TTL: TNumber;
	CACHE_PREFIX: TOptional<TString>;
	CACHE_ENABLED: TBoolean;
}> = t.object({
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
	protected readonly alepha: Alepha = $inject(Alepha);
	protected readonly cacheProvider: CacheProvider = $inject(CacheProvider);
	protected readonly memoryCacheProvider: MemoryCacheProvider =
		$inject(MemoryCacheProvider);
	protected readonly dateTimeProvider: DateTimeProvider =
		$inject(DateTimeProvider);
	protected readonly env: Static<typeof envSchema> = $env(envSchema);
	protected readonly caches: Cache[] = [];

	protected encoder: TextEncoder = new TextEncoder();
	protected decoder: TextDecoder = new TextDecoder();
	protected codes = {
		BINARY: 0x01,
		JSON: 0x02,
		STRING: 0x03,
	};

	protected readonly configure = $hook({
		on: "configure",
		handler: async () => {
			this.processDescriptors();
		},
	});

	public register(cache: Cache): Cache {
		this.caches.push(cache);
		return cache;
	}

	public processDescriptors(): void {
		const caches = this.alepha.getDescriptorValues($cache);
		for (const { value, key, instance } of caches) {
			const { [OPTIONS]: options } = value;
			const name = options.name ?? `${instance.constructor.name}:${key}`;
			const cache = { options, name };

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
	public async clear(): Promise<void> {
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
			return this.cacheProvider; // use default provider
		}

		if (options.provider === "memory") {
			return this.memoryCacheProvider; // force to use memory cache
		}

		if (typeof options.provider === "object") {
			return options.provider; // use custom provider instance
		}

		return options.provider(); // use provider factory function
	}

	/**
	 * Get the cache key for the given state and arguments.
	 */
	public key(cache: Cache, ...args: any[]): string {
		return cache.options.key
			? cache.options.key(...args)
			: JSON.stringify(args);
	}

	/**
	 * Invalidate the cache for the given state and arguments.
	 */
	public async invalidate(cache: Cache, ...keys: string[]): Promise<void> {
		await this.provider(cache.options).del(cache.name, ...keys);
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
		const data = await provider.get(cache.name, key);
		if (data) {
			return await this.deserialize<TReturn>(data);
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
			cache.name,
			key,
			this.serialize(value),
			px > 0 ? px : undefined,
		);
	}

	protected serialize<TReturn>(value: TReturn): Uint8Array {
		if (value instanceof Uint8Array) {
			return new Uint8Array([this.codes.BINARY, ...value]); // TODO: check if copy is ok?
		}

		if (typeof value === "string") {
			return new Uint8Array([this.codes.STRING, ...this.encoder.encode(value)]);
		}

		return new Uint8Array([
			this.codes.JSON,
			...this.encoder.encode(JSON.stringify(value)),
		]);
	}

	protected async deserialize<TReturn>(
		uint8Array: Uint8Array,
	): Promise<TReturn> {
		const type = uint8Array[0];
		const payload = uint8Array.slice(1);

		if (type === this.codes.BINARY) {
			return payload as TReturn;
		}
		if (type === this.codes.JSON) {
			return JSON.parse(this.decoder.decode(payload)) as TReturn;
		}
		if (type === this.codes.STRING) {
			return this.decoder.decode(payload) as TReturn;
		}

		throw new CacheError(`Unknown serialization type: ${type}`);
	}
}

export interface Cache<TReturn = any, TParameter extends any[] = any[]> {
	name: string;
	options: CacheDescriptorOptions<TReturn, TParameter>;
}
