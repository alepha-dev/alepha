import { randomUUID } from "node:crypto";
import { Alepha, type Env, type Service } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { expect } from "vitest";
import { $cache, CacheProvider, MemoryCacheProvider } from "../src";

export class TestCache {
  cursor_a = 0;
  cursor_b = 0;

  a = $cache({
    key: (args) => args.name,
    ttl: [5, "seconds"],
    handler: async (user: { name: string }) => {
      return `${user.name}:${this.cursor_a++}`;
    },
  });

  b = $cache({
    provider: "memory",
    key: (args) => args.name,
    ttl: 0,
    handler: async (user: { name: string }) => {
      return `${user.name}:${this.cursor_b++}`;
    },
  });
}

export const testCacheBasic = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  const app = Alepha.create({
    env,
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });
  const test = app.inject(TestCache);
  const time = app.inject(DateTimeProvider);
  await app.start();

  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "B" })).toBe("B:1");
  expect(await test.a({ name: "B" })).toBe("B:1");

  if (!(app.inject(CacheProvider) instanceof MemoryCacheProvider)) {
    return; // we can mock only MemoryCacheProvider
  }

  await time.travel([2, "seconds"]);
  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "B" })).toBe("B:1");

  await time.travel([4, "seconds"]);
  expect(await test.a({ name: "A" })).toBe("A:2");
  expect(await test.a({ name: "A" })).toBe("A:2");
  expect(await test.a({ name: "B" })).toBe("B:3");
};

export const testCacheStop = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  const app = Alepha.create({
    env,
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });

  const test = app.inject(TestCache);
  await app.start();
  await app.stop();

  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "A" })).toBe("A:1");
  expect(await test.a({ name: "A" })).toBe("A:2");
};

export const testCacheMissingProvider = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  const app = Alepha.create({
    env,
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });

  const test = app.inject(TestCache);

  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "A" })).toBe("A:1");
};

export const testCacheDisabled = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  const app = Alepha.create({
    env: {
      REDIS_CACHE_PREFIX: randomUUID(),
      CACHE_ENABLED: false,
      ...env,
    },
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });

  const test = app.inject(TestCache);
  await app.start();

  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "A" })).toBe("A:1");
  expect(await test.a({ name: "B" })).toBe("B:2");
};

export const testCacheInvalidateByKey = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  const app = Alepha.create({
    env,
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });

  const test = app.inject(TestCache);
  await app.start();

  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "B" })).toBe("B:1");

  await test.a.invalidate("A");
  expect(await test.a({ name: "B" })).toBe("B:1");
  expect(await test.a({ name: "A" })).toBe("A:2");
};

export const testCacheInvalidateByArgs = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  const app = Alepha.create({
    env,
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });

  const test = app.inject(TestCache);
  await app.start();

  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "B" })).toBe("B:1");

  await test.a.invalidate(test.a.key({ name: "A" }));
  expect(await test.a({ name: "B" })).toBe("B:1");
  expect(await test.a({ name: "A" })).toBe("A:2");
};

export const testCacheInvalidateAll = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  const app = Alepha.create({
    env,
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });

  const test = app.inject(TestCache);
  await app.start();

  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "A" })).toBe("A:0");

  await test.a.invalidate();
  expect(await test.a({ name: "A" })).toBe("A:1");
};

export const testCacheClear = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  const app = Alepha.create({
    env,
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });

  const test = app.inject(TestCache);
  await app.start();

  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.b({ name: "A" })).toBe("A:0");
  expect(await test.b({ name: "A" })).toBe("A:0");

  await Promise.all(app.descriptors($cache).map((cache) => cache.invalidate()));

  expect(await test.a({ name: "A" })).toBe("A:1");
  expect(await test.b({ name: "A" })).toBe("A:1");
};

export const testCacheReturnTypes = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  class Types {
    json = $cache({
      handler: () => ({ a: 1 }),
    });
    int = $cache({
      handler: () => 1,
    });
    bool = $cache({
      handler: () => true,
    });
    string = $cache({
      handler: () => '{ "a": 1 }',
    });
  }

  const app = Alepha.create({
    env,
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });

  const test = app.inject(Types);

  expect(await test.json()).toEqual({ a: 1 });
  expect(await test.json()).toEqual({ a: 1 });
  expect(await test.json()).toEqual({ a: 1 });
  expect(await test.int()).toBe(1);
  expect(await test.int()).toBe(1);
  expect(await test.int()).toBe(1);
  expect(await test.bool()).toBe(true);
  expect(await test.bool()).toBe(true);
  expect(await test.bool()).toBe(true);
  expect(await test.string()).toBe('{ "a": 1 }');
  expect(await test.string()).toBe('{ "a": 1 }');
};

export const testCacheKeys = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
) => {
  const alepha = Alepha.create({
    env,
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });
  class TestApp {
    cache = $cache<string>();
  }

  const app = alepha.inject(TestApp);
  const provider = alepha.inject(CacheProvider);
  await alepha.start();

  app.cache.set("test:A", "A");
  app.cache.set("test:B", "B");
  app.cache.set("hello", "C");
  expect(await provider.keys("TestApp:cache").then((it) => it.length)).toEqual(
    3,
  );

  await app.cache.invalidate("test:*");
  expect(await provider.keys("TestApp:cache").then((it) => it.length)).toEqual(
    1,
  );
};

export const testSimpleKeyMappingHandler = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  class App {
    i = 0;
    run = $cache({
      key: (name: string) => name,
      ttl: [5, "seconds"],
      handler: async (name: string) => {
        this.i++;
        return `${name}=${this.i}`;
      },
    });
  }
  const alepha = Alepha.create({
    env,
  })
    .with({
      provide: CacheProvider,
      use: cacheProvider,
    })
    .with(App);

  await alepha.start();
  const app = alepha.inject(App);
  expect(await app.run("A")).toBe("A=1");
  expect(await app.run("A")).toBe("A=1");
  expect(await app.run("A")).toBe("A=1");
  expect(await app.run("A")).toBe("A=1");
  expect(await app.run("B")).toBe("B=2");
  expect(await app.run("B")).toBe("B=2");
  expect(await app.run("B")).toBe("B=2");
  expect(await app.run("C")).toBe("C=3");
};

export const testCacheProviderClear = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  class TestClearCache {
    cursor_a = 0;
    cursor_b = 0;

    a = $cache({
      key: (args) => args.name,
      ttl: [5, "seconds"],
      handler: async (user: { name: string }) => {
        return `${user.name}:${this.cursor_a++}`;
      },
    });

    b = $cache({
      key: (args) => args.name,
      handler: async (user: { name: string }) => {
        return `${user.name}:${this.cursor_b++}`;
      },
    });
  }

  const app = Alepha.create({
    env,
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });

  const test = app.inject(TestClearCache);
  const provider = app.inject(CacheProvider);
  await app.start();

  // Set some cache values
  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.a({ name: "B" })).toBe("B:1");
  expect(await test.b({ name: "C" })).toBe("C:0");
  expect(await test.b({ name: "C" })).toBe("C:0");

  // Verify cache is working
  expect(await test.a({ name: "A" })).toBe("A:0");
  expect(await test.b({ name: "C" })).toBe("C:0");

  // Clear all cache
  await provider.clear();

  // Verify cache was cleared - new values should be generated
  expect(await test.a({ name: "A" })).toBe("A:2");
  expect(await test.a({ name: "B" })).toBe("B:3");
  expect(await test.b({ name: "C" })).toBe("C:1");
};
