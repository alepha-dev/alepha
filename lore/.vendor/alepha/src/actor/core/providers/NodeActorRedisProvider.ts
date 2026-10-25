import { NodeRedisProvider } from "alepha/redis";
/**
 * Existing Node Redis operations with offline command replay disabled.
 */
export class NodeActorRedisProvider extends NodeRedisProvider {
  public static readonly id: string = "alepha.actor.NodeActorRedisProvider";
  protected override getClientOptions(): { disableOfflineQueue?: boolean } {
    return { ...super.getClientOptions(), disableOfflineQueue: true };
  }
}
