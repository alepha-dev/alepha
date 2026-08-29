import { $atom, $inject, $store, type Infer, z } from "alepha";
import {
  QueueDelayNotSupportedError,
  QueueProvider,
  type QueuePushOptions,
} from "alepha/queue";
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

export type RedisQueueOptions = Infer<typeof redisQueueOptions.schema>;

declare module "alepha" {
  interface State {
    [redisQueueOptions.key]: RedisQueueOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class RedisQueueProvider extends QueueProvider {
  protected readonly options = $store(redisQueueOptions);
  protected readonly redisProvider: RedisProvider = $inject(RedisProvider);

  public prefix(queue: string): string {
    return `${this.options.prefix}:${queue}`;
  }

  public async push(
    queue: string,
    message: string,
    options?: QueuePushOptions,
  ): Promise<void> {
    if (options?.delaySeconds && options.delaySeconds > 0) {
      // Declined, never enqueued immediately. A plain LIST has no notion of
      // a due time, and `LPUSH`ing anyway would deliver NOW - which for a
      // retry is worse than not delivering at all, since the caller falls
      // back to a local timer and, behind that, the outbox sweep.
      //
      // The ZSET delay tier that would let this be honoured is deliberately
      // deferred; it is a scale optimisation, not a correctness gap, because
      // on Node the caller's promoting timer already gives exact backoff in
      // both dispatch modes with zero Redis work. It has two written-down
      // triggers, on quest #1569.
      throw new QueueDelayNotSupportedError(
        "RedisQueueProvider cannot delay delivery (no ZSET tier); declining rather than enqueueing immediately.",
      );
    }
    await this.redisProvider.lpush(this.prefix(queue), message);
  }

  public async pop(queue: string): Promise<string | undefined> {
    return this.redisProvider.rpop(this.prefix(queue));
  }
}
