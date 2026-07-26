import { $atom, $inject, $state, type Static, z } from "alepha";
import { QueueProvider } from "alepha/queue";
import { RedisProvider } from "alepha/redis";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Redis queue configuration atom.
 */
export const redisQueueOptions = $atom({
  name: "alepha.queue.redis.options",
  schema: z.object({
    prefix: z.text({
      default: "queue",
      description: "Prefix for all queue keys in Redis.",
    }),
  }),
  default: {
    prefix: "queue",
  },
  serverOnly: true,
});

export type RedisQueueOptions = Static<typeof redisQueueOptions.schema>;

declare module "alepha" {
  interface State {
    [redisQueueOptions.key]: RedisQueueOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class RedisQueueProvider extends QueueProvider {
  protected readonly options = $state(redisQueueOptions);
  protected readonly redisProvider: RedisProvider = $inject(RedisProvider);

  public prefix(queue: string): string {
    return `${this.options.prefix}:${queue}`;
  }

  public async push(queue: string, message: string): Promise<void> {
    await this.redisProvider.lpush(this.prefix(queue), message);
  }

  public async pop(queue: string): Promise<string | undefined> {
    return this.redisProvider.rpop(this.prefix(queue));
  }
}
