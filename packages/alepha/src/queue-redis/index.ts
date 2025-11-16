import { $module, type Alepha } from "alepha";
import { AlephaQueue, QueueProvider } from "alepha/queue";
import { RedisQueueProvider } from "./providers/RedisQueueProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/RedisQueueProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Queue that provides Redis queue capabilities.
 *
 * @see {@link RedisQueueProvider}
 * @module alepha.queue.redis
 */
export const AlephaQueueRedis = $module({
  name: "alepha.queue.redis",
  services: [RedisQueueProvider],
  register: (alepha: Alepha) =>
    alepha
      .with({
        optional: true,
        provide: QueueProvider,
        use: RedisQueueProvider,
      })
      .with(AlephaQueue),
});
