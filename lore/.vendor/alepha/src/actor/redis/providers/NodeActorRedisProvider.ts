import { NodeRedisProvider } from "alepha/redis";
/**
 * Existing Node Redis operations with offline command replay disabled.
 */
export class NodeActorRedisProvider extends NodeRedisProvider {
  protected override getClientOptions(): { disableOfflineQueue?: boolean } {
    return { ...super.getClientOptions(), disableOfflineQueue: true };
  }
}
