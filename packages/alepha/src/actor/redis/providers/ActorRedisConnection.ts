import type { RedisProvider } from "alepha/redis";
/**
 * Injection token for an existing runtime Redis provider's get/eval seam.
 * Keeps the Node client out of Bun's conditional entry and vice versa.
 */
export abstract class ActorRedisConnection {
  public abstract get: RedisProvider["get"];
  public abstract eval: RedisProvider["eval"];
  public abstract set: RedisProvider["set"];
  public abstract del: RedisProvider["del"];
  public abstract keys: RedisProvider["keys"];
}
