import { __bind, type Alepha, type Module } from "@alepha/core";
import { RedisProvider } from "./providers/RedisProvider.ts";
import { RedisSubscriberProvider } from "./providers/RedisSubscriberProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/RedisProvider.ts";
export * from "./providers/RedisSubscriberProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Redis client provider for Alepha applications.
 *
 * @see {@link RedisProvider}
 * @module alepha.redis
 */
export class AlephaRedis implements Module {
	public readonly name = "alepha.redis";
	public readonly $services = (alepha: Alepha): Alepha =>
		alepha.with(RedisProvider);
}

__bind(RedisProvider, AlephaRedis);
__bind(RedisSubscriberProvider, AlephaRedis);
