import { $hook, $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import {
  type NodeRedisClient,
  NodeRedisProvider,
} from "./NodeRedisProvider.ts";
import {
  RedisSubscriberProvider,
  type SubscribeCallback,
} from "./RedisSubscriberProvider.ts";

/**
 * Node.js Redis subscriber provider using `@redis/client`.
 *
 * This provider creates a dedicated Redis connection for subscriptions,
 * as Redis requires separate connections for pub/sub operations.
 *
 * @example
 * ```ts
 * const subscriber = alepha.inject(RedisSubscriberProvider);
 * await subscriber.subscribe("channel", (message, channel) => {
 *   console.log(`Received: ${message} on ${channel}`);
 * });
 * ```
 */
export class NodeRedisSubscriberProvider extends RedisSubscriberProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly redisProvider = $inject(NodeRedisProvider);
  protected readonly client: NodeRedisClient = this.createClient();

  public get subscriber(): NodeRedisClient {
    if (!this.client.isReady) {
      throw new AlephaError("Redis subscriber client is not ready");
    }

    return this.client;
  }

  public override get isReady(): boolean {
    return this.client.isReady;
  }

  protected readonly start = $hook({
    on: "start",
    handler: () => this.connect(),
  });

  protected readonly stop = $hook({
    on: "stop",
    handler: () => this.close(),
  });

  public override async connect(): Promise<void> {
    this.log.debug("Connecting subscriber...");
    await this.client.connect();
    this.log.info("Subscriber connection OK");
  }

  public override async close(): Promise<void> {
    if (!this.client.isReady) {
      this.log.debug("Subscriber client not ready, skipping close");
      return;
    }
    this.log.debug("Closing subscriber connection...");
    await this.client.close();
    this.log.info("Subscriber connection closed");
  }

  public override async subscribe(
    channel: string,
    callback: SubscribeCallback,
  ): Promise<void> {
    await this.subscriber.subscribe(channel, callback);
  }

  public override async unsubscribe(
    channel: string,
    callback?: SubscribeCallback,
  ): Promise<void> {
    await this.subscriber.unsubscribe(channel, callback);
  }

  public override async pSubscribe(
    pattern: string,
    callback: SubscribeCallback,
  ): Promise<void> {
    await this.subscriber.pSubscribe(pattern, callback);
  }

  public override async pUnsubscribe(
    pattern: string,
    callback?: SubscribeCallback,
  ): Promise<void> {
    await this.subscriber.pUnsubscribe(pattern, callback);
  }

  /**
   * Redis subscriber client factory method.
   */
  protected createClient(): NodeRedisClient {
    const client = this.redisProvider.duplicate();

    client.on("error", (error) => {
      if (this.alepha.isStarted()) {
        this.log.error(error);
      }
    });

    return client;
  }
}
