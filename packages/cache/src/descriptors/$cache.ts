import { __descriptor, KIND, NotImplementedError, OPTIONS } from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";
import type { CacheProvider } from "../providers/CacheProvider.ts";

const KEY = "CACHE";

/**
 * Cache Descriptor
 */
export const $cache: {
	<TReturn = string, TParameter extends any[] = any[]>(
		options?: CacheDescriptorOptions<TReturn, TParameter>,
	): CacheDescriptor<TReturn, TParameter>;
	[KIND]: string;
} = <TReturn = string, TParameter extends any[] = any[]>(
	options: CacheDescriptorOptions<TReturn, TParameter> = {},
): CacheDescriptor<TReturn, TParameter> => {
	__descriptor(KEY);

	const $: CacheDescriptor<TReturn, TParameter> = async (
		...args: TParameter
	): Promise<TReturn> => {
		if (!options.handler) {
			throw new NotImplementedError(KEY);
		}

		return options.handler(...args);
	};

	$[KIND] = KEY;
	$[OPTIONS] = options;

	$.key = (): string => {
		throw new NotImplementedError(KEY);
	};

	$.invalidate = async (): Promise<void> => {
		throw new NotImplementedError(KEY);
	};

	$.set = async (): Promise<void> => {
		throw new NotImplementedError(KEY);
	};

	$.get = async (): Promise<TReturn> => {
		throw new NotImplementedError(KEY);
	};

	return $;
};

$cache[KIND] = KEY;

// ---------------------------------------------------------------------------------------------------------------------

export interface CacheDescriptorOptions<
	TReturn,
	TParameter extends any[] = any[],
> {
	/**
	 * The cache name. This is useful for invalidating multiple caches at once.
	 *
	 * Store key as `cache:$name:$key`.
	 *
	 * @default ClassName:methodName
	 */
	name?: string;

	/**
	 * Function which returns cached data.
	 * @param args Arguments for handler.
	 */
	handler?: (...args: TParameter) => TReturn;

	/**
	 * The key generator for the cache.
	 * If not provided, the arguments will be json.stringify().
	 */
	key?: (...args: TParameter) => string;

	/**
	 * The store provider for the cache.
	 * If not provided, the default store provider will be used.
	 */
	provider?: CacheProvider | (() => CacheProvider) | "memory";

	/**
	 * The time-to-live for the cache in seconds.
	 * Set 0 to skip expiration.
	 *
	 * @default 300 (5 minutes).
	 */
	ttl?: DurationLike;

	/**
	 * If the cache is disabled.
	 */
	disabled?: boolean;
}

export interface CacheDescriptor<
	TReturn = any,
	TParameter extends any[] = any[],
> {
	[KIND]: typeof KEY;
	[OPTIONS]: CacheDescriptorOptions<TReturn, TParameter>;

	/**
	 * Cache handler.
	 */
	(...args: TParameter): Promise<TReturn>;

	/**
	 * Cache key generator.
	 */
	key: (...args: TParameter) => string;

	/**
	 * Invalidate cache by keys.
	 */
	invalidate: (...keys: string[]) => Promise<void>;

	/**
	 * Set cache with key, value and ttl.
	 *
	 * @param key
	 * @param value
	 * @param ttl
	 */
	set: (key: string, value: TReturn, ttl?: DurationLike) => Promise<void>;

	/**
	 * Get cache by key.
	 *
	 * @param key
	 */
	get: (key: string) => Promise<TReturn | undefined>;
}
