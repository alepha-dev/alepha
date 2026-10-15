import { $module, type Alepha } from "alepha";
import { RedisActivation } from "alepha/redis";

import { $subscriber } from "./primitives/$subscriber.ts";
import { $topic } from "./primitives/$topic.ts";
import { MemoryTopicProvider } from "./providers/MemoryTopicProvider.ts";
import { RedisTopicProvider } from "./providers/RedisTopicProvider.ts";
import { TopicProvider } from "./providers/TopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/TopicTimeoutError.ts";
export * from "./primitives/$subscriber.ts";
export * from "./primitives/$topic.ts";
export * from "./providers/MemoryTopicProvider.ts";
export * from "./providers/RedisTopicProvider.ts";
export * from "./providers/TopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Publish/subscribe messaging for event-driven architectures.
 *
 * **Features:**
 * - Pub/sub topics with type-safe messages
 * - Topic subscription handlers
 * - Multiple subscriber support
 * - Message filtering and routing
 * - Providers: Redis when `REDIS_URL` is set, Memory otherwise
 *
 * Set `REDIS_URL` and a message published on one instance reaches every
 * instance: WebSocket broadcasts, `parameter:sync` and `lock:end` included.
 * Leave it unset and topics stay inside this process. An app's own
 * `TopicProvider` substitution wins over both.
 *
 * @module alepha.topic
 */
export const AlephaTopic = $module({
  name: "alepha.topic",
  primitives: [$topic, $subscriber],
  services: [TopicProvider],
  variants: [MemoryTopicProvider, RedisTopicProvider],
  register: (alepha: Alepha) =>
    alepha.with({
      optional: true,
      provide: TopicProvider,
      use: alepha.inject(RedisActivation).isActive()
        ? RedisTopicProvider
        : MemoryTopicProvider,
    }),
});
