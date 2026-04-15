import { $module, type Alepha } from "alepha";
import { $subscriber } from "./primitives/$subscriber.ts";
import { $topic } from "./primitives/$topic.ts";
import { MemoryTopicProvider } from "./providers/MemoryTopicProvider.ts";
import { TopicProvider } from "./providers/TopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/TopicTimeoutError.ts";
export * from "./primitives/$subscriber.ts";
export * from "./primitives/$topic.ts";
export * from "./providers/MemoryTopicProvider.ts";
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
 * - Providers: Memory (dev), Redis (production)
 *
 * @module alepha.topic
 */
export const AlephaTopic = $module({
  name: "alepha.topic",
  primitives: [$topic, $subscriber],
  services: [TopicProvider],
  variants: [MemoryTopicProvider],
  register: (alepha: Alepha) =>
    alepha.with({
      optional: true,
      provide: TopicProvider,
      use: MemoryTopicProvider,
    }),
});
