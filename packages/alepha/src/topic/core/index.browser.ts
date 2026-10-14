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
 * The browser, react-native and workerd half of `alepha.topic`: memory only.
 *
 * ⚠️ It never imports `RedisTopicProvider`, which would pull `alepha/redis`
 * into every client bundle using `alepha/websocket` and into every Worker.
 * Keep its exports in step with `index.ts` by hand, minus the Redis provider.
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
