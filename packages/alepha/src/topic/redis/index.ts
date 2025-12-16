import { $module, type Alepha } from "alepha";
import { AlephaTopic, TopicProvider } from "alepha/topic";
import { RedisTopicProvider } from "./providers/RedisTopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/RedisTopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Topic that provides Redis pub/sub capabilities.
 *
 * @see {@link RedisTopicProvider}
 * @module alepha.topic.redis
 */
export const AlephaTopicRedis = $module({
  name: "alepha.topic.redis",
  services: [RedisTopicProvider],
  register: (alepha: Alepha): Alepha =>
    alepha
      .with({
        optional: true,
        provide: TopicProvider,
        use: RedisTopicProvider,
      })
      .with(AlephaTopic),
});
