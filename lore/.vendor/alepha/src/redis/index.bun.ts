import { $module, type Alepha } from "alepha";

import { BunRedisProvider } from "./providers/BunRedisProvider.ts";
import { BunRedisSubscriberProvider } from "./providers/BunRedisSubscriberProvider.ts";
import { RedisProvider } from "./providers/RedisProvider.ts";
import { RedisSubscriberProvider } from "./providers/RedisSubscriberProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/BunRedisProvider.ts";
export * from "./providers/BunRedisSubscriberProvider.ts";
export * from "./providers/RedisProvider.ts";
export * from "./providers/RedisSubscriberProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaRedis = $module({
  name: "alepha.redis",
  services: [RedisProvider, RedisSubscriberProvider],
  variants: [BunRedisProvider, BunRedisSubscriberProvider],
  register: (alepha: Alepha) => {
    alepha
      .with({
        provide: RedisProvider,
        use: BunRedisProvider,
      })
      .with({
        provide: RedisSubscriberProvider,
        use: BunRedisSubscriberProvider,
      });
  },
});
