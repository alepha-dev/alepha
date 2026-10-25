import { BunRedisProvider } from "alepha/redis";
/**
 * Existing Bun Redis operations with offline command replay disabled.
 */
export class BunActorRedisProvider extends BunRedisProvider {
  protected override getClientOptions(): ConstructorParameters<
    typeof Bun.RedisClient
  >[1] {
    return { ...super.getClientOptions(), enableOfflineQueue: false };
  }
}
