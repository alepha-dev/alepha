import { randomUUID } from "node:crypto";
import { Alepha, type Env, type Service } from "alepha";
import { $cache, CacheProvider, MemoryCacheProvider } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { expect } from "vitest";

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

  await Promise.all(app.primitives($cache).map((cache) => cache.invalidate()));

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

export const testCacheIncr = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  const app = Alepha.create({
    env,
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });

  const provider = app.inject(CacheProvider);
  await app.start();

  const name = "test-incr";
  const key = `counter:${randomUUID()}`;

  // First increment creates the key
  const val1 = await provider.incr(name, key, 1);
  expect(val1).toBe(1);

  // Subsequent increments add to existing value
  const val2 = await provider.incr(name, key, 5);
  expect(val2).toBe(6);

  // Negative amounts work (decrement)
  const val3 = await provider.incr(name, key, -2);
  expect(val3).toBe(4);
};

export const testCacheFalsyValues = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  class FalsyCache {
    zeroCount = 0;
    emptyCount = 0;
    falseCount = 0;
    nullCount = 0;

    zero = $cache({
      handler: () => {
        this.zeroCount++;
        return 0;
      },
    });

    empty = $cache({
      handler: () => {
        this.emptyCount++;
        return "";
      },
    });

    bool = $cache({
      handler: () => {
        this.falseCount++;
        return false;
      },
    });

    nil = $cache({
      handler: () => {
        this.nullCount++;
        return null;
      },
    });
  }

  const app = Alepha.create({ env }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });
  const test = app.inject(FalsyCache);
  await app.start();

  // Each value should be cached after first call
  expect(await test.zero()).toBe(0);
  expect(await test.zero()).toBe(0);
  expect(await test.zero()).toBe(0);
  expect(test.zeroCount).toBe(1);

  expect(await test.empty()).toBe("");
  expect(await test.empty()).toBe("");
  expect(test.emptyCount).toBe(1);

  expect(await test.bool()).toBe(false);
  expect(await test.bool()).toBe(false);
  expect(test.falseCount).toBe(1);

  expect(await test.nil()).toBe(null);
  expect(await test.nil()).toBe(null);
  expect(test.nullCount).toBe(1);
};

export const testCacheSetDisabled = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  class ManualCache {
    store = $cache<string>();
  }

  const app = Alepha.create({
    env: { CACHE_ENABLED: false, ...env },
  }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });

  const test = app.inject(ManualCache);
  const provider = app.inject(CacheProvider);
  await app.start();

  // set() should be a no-op when cache is disabled
  await test.store.set("key1", "value1");
  expect(await provider.has("ManualCache:store", "key1")).toBe(false);
};

export const testCachePrimitiveIncr = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  class CounterApp {
    counter = $cache<number>();
  }

  const app = Alepha.create({ env }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });
  const test = app.inject(CounterApp);
  await app.start();

  // incr through the primitive
  expect(await test.counter.incr("views")).toBe(1);
  expect(await test.counter.incr("views")).toBe(2);
  expect(await test.counter.incr("views", 5)).toBe(7);
  expect(await test.counter.incr("views", -3)).toBe(4);
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

export const testCacheCompress = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  class CompressedCache {
    count = 0;
    data = $cache({
      compress: true,
      handler: () => {
        this.count++;
        return {
          users: Array.from({ length: 100 }, (_, i) => ({
            id: i,
            name: `User ${i}`,
            email: `user${i}@example.com`,
          })),
        };
      },
    });
  }

  const app = Alepha.create({ env }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });
  const test = app.inject(CompressedCache);
  await app.start();

  const result1 = await test.data();
  expect(result1.users).toHaveLength(100);
  expect(result1.users[0]).toEqual({
    id: 0,
    name: "User 0",
    email: "user0@example.com",
  });

  // Second call returns cached (and compressed) value
  const result2 = await test.data();
  expect(result2).toEqual(result1);
  expect(test.count).toBe(1);

  // Verify stored data has COMPRESSED prefix and is smaller than raw JSON
  const provider = app.inject(CacheProvider);
  const raw = await provider.get("CompressedCache:data", "[]");
  expect(raw).toBeDefined();
  expect(raw![0]).toBe(0x04);

  const uncompressedJson = JSON.stringify(result1);
  expect(raw!.length).toBeLessThan(uncompressedJson.length);
};

export const testCacheCompressTypes = async (
  env: Env = {},
  cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
  class CompressedTypes {
    json = $cache({
      compress: true,
      handler: () => ({ key: "value".repeat(50) }),
    });
    str = $cache({
      compress: true,
      handler: () => "hello".repeat(50),
    });
    num = $cache({
      compress: true,
      handler: () => 42,
    });
    bool = $cache({
      compress: true,
      handler: () => true,
    });
  }

  const app = Alepha.create({ env }).with({
    provide: CacheProvider,
    use: cacheProvider,
  });
  const test = app.inject(CompressedTypes);
  await app.start();

  expect(await test.json()).toEqual({ key: "value".repeat(50) });
  expect(await test.json()).toEqual({ key: "value".repeat(50) });
  expect(await test.str()).toBe("hello".repeat(50));
  expect(await test.str()).toBe("hello".repeat(50));
  expect(await test.num()).toBe(42);
  expect(await test.num()).toBe(42);
  expect(await test.bool()).toBe(true);
  expect(await test.bool()).toBe(true);
};
