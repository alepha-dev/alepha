import { $atom, $inject, $store, type Infer, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { QueueProvider, type QueuePushOptions } from "alepha/queue";
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
    delayScanBatch: z
      .integer()
      .min(1)
      .describe(
        "How many due messages one delay-tier scan promotes into the list. The scan only runs when the list is empty, so this bounds a burst coming due at once without adding a round trip to a busy queue.",
      ),
  }),
  default: {
    prefix: "queue",
    delayScanBatch: 50,
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

/**
 * Redis-backed queue: a LIST for what is deliverable now, and a **sorted set
 * scored by due-time** for what is not yet.
 *
 * The delay tier exists because ignoring a delay is not a graceful
 * degradation: for a push transport it means delivering NOW, which for a
 * retry is zero backoff against a downstream that has just failed. Before
 * this, `push` declined a delayed send outright and the caller fell back to
 * a local timer (see {@link QueuePushOptions.delaySeconds}). That fallback
 * is still the right answer for any backend without a delay tier, and it is
 * still what happens if this one is unreachable, because the caller's outbox
 * row and its sweep remain the truth either way.
 */
export class RedisQueueProvider extends QueueProvider {
  protected readonly options = $store(redisQueueOptions);
  protected readonly redisProvider: RedisProvider = $inject(RedisProvider);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly crypto = $inject(CryptoProvider);

  public prefix(queue: string): string {
    return `${this.options.prefix}:${queue}`;
  }

  /**
   * Key of the delay tier for a queue. A separate key rather than a field on
   * the list, so an undelayed push stays a single `LPUSH` and pays nothing.
   */
  public delayKey(queue: string): string {
    return `${this.prefix(queue)}:delayed`;
  }

  public async push(
    queue: string,
    message: string,
    options?: QueuePushOptions,
  ): Promise<void> {
    const delaySeconds = options?.delaySeconds ?? 0;
    if (delaySeconds > 0) {
      const dueAt = this.dt.nowMillis() + delaySeconds * 1000;
      await this.redisProvider.zadd(
        this.delayKey(queue),
        dueAt,
        this.encodeMember(message),
      );
      return;
    }
    await this.redisProvider.lpush(this.prefix(queue), message);
  }

  public async pop(queue: string): Promise<string | undefined> {
    const message = await this.redisProvider.rpop(this.prefix(queue));
    if (message !== undefined) {
      return message;
    }

    // The list is empty, which is the only moment worth spending a round
    // trip on the delay tier. Scanning on every pop would double the Redis
    // traffic of a busy queue to serve messages that are, by definition,
    // not due yet; scanning here costs one extra call on a poll the worker
    // was about to sleep after anyway.
    const promoted = await this.promoteDue(queue);
    if (promoted === 0) {
      return undefined;
    }
    return this.redisProvider.rpop(this.prefix(queue));
  }

  /**
   * Move everything that has come due out of the sorted set and into the
   * list.
   *
   * **`ZREM` is the claim.** It reports whether *this* call removed the
   * member, so two pollers racing the same due message agree on an owner
   * without a Lua script and without a duplicate delivery. The loser simply
   * moves on.
   *
   * Removing before pushing rather than after is deliberate, and it is the
   * one place this design chooses a loss over a duplicate. A crash between
   * the two loses the *message* but not the execution: the outbox row is
   * still `scheduled` with its own `scheduledAt`, and the sweep delivers it.
   * That is the same rule the whole interface runs on, so the tier can never
   * be worse than not having it. Pushing first would instead deliver twice
   * on a crash, which costs real duplicate work every time.
   *
   * @returns how many messages became deliverable.
   */
  protected async promoteDue(queue: string): Promise<number> {
    const key = this.delayKey(queue);
    const due = await this.redisProvider.zrangebyscore(
      key,
      0,
      this.dt.nowMillis(),
      Math.max(1, this.options.delayScanBatch),
    );
    if (due.length === 0) {
      return 0;
    }

    let promoted = 0;
    for (const member of due) {
      const removed = await this.redisProvider.zrem(key, member);
      if (removed === 0) {
        // Another poller got there first.
        continue;
      }
      await this.redisProvider.lpush(
        this.prefix(queue),
        this.decodeMember(member),
      );
      promoted++;
    }
    return promoted;
  }

  /**
   * A sorted set stores each member once: re-adding one only updates its
   * score. Two identical messages delayed by the same caller would therefore
   * collapse into one and the second would be **silently lost**, which the
   * list has no equivalent of. A random prefix makes every member distinct.
   */
  protected encodeMember(message: string): string {
    return `${this.crypto.randomUUID()}:${message}`;
  }

  protected decodeMember(member: string): string {
    const separator = member.indexOf(":");
    return separator === -1 ? member : member.slice(separator + 1);
  }
}
