import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import type { RedisClient } from "./RedisProvider.ts";
import { RedisProvider } from "./RedisProvider.ts";

export class RedisSubscriberProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly redisProvider: RedisProvider = $inject(RedisProvider);
  protected readonly client: RedisClient = this.createClient();

  public get subscriber(): RedisClient {
    if (!this.client.isReady) {
      throw new Error("Redis client is not ready");
    }

    return this.client;
  }

  protected readonly start = $hook({
    on: "start",
    handler: () => this.connect(),
  });

  protected readonly stop = $hook({
    on: "stop",
    handler: () => this.close(),
  });

  public async connect(): Promise<void> {
    this.log.debug("Connecting...");
    await this.client.connect();
    this.log.info("Connection OK");
  }

  public async close(): Promise<void> {
    this.log.debug("Closing connection...");
    this.subscriber.close();
    this.log.info("Connection closed");
  }

  /**
   * Redis subscriber client factory method.
   */
  protected createClient(): RedisClient {
    const client = this.redisProvider.duplicate();

    client.on("error", (error) => {
      if (this.alepha.isStarted()) {
        this.log.error(error);
      }
    });

    return client;
  }
}
