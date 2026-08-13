import { Alepha } from "alepha";
import { $cache, CacheProvider, MemoryCacheProvider } from "alepha/cache";
import { DatabaseCacheProvider } from "alepha/cache/database";
import { describe, expect, it } from "vitest";

/**
 * Mirrors the inline filter at `cli/platform/commands/platform.ts:706-709`.
 *
 * Pulled out as a tiny helper so the decision matrix can be tested without
 * instantiating the full PlatformCommand (which depends on Vite, AppEntry,
 * etc. and is awkward to spin up under unit tests). If the filter changes,
 * update both this helper and the one in platform.ts.
 */
const detectHasKV = (alepha: Alepha): boolean => {
  return (
    alepha.primitives("cache").filter((it: any) => it.options?.provider == null)
      .length > 0
  );
};

describe("platform.detectResources — hasKV decision", () => {
  it("is false when no $cache primitive is registered", () => {
    const alepha = Alepha.create();
    expect(detectHasKV(alepha)).toBe(false);
  });

  it("is TRUE when a $cache has no explicit provider (default cache wanted)", () => {
    class App {
      cache = $cache<string>({ name: "foo" });
    }
    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    alepha.inject(App);
    expect(detectHasKV(alepha)).toBe(true);
  });

  it("is FALSE when every $cache pins provider:'memory'", () => {
    class App {
      cache = $cache<string>({ name: "foo", provider: "memory" });
    }
    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    alepha.inject(App);
    expect(detectHasKV(alepha)).toBe(false);
  });

  it("is FALSE when every $cache pins provider:DatabaseCacheProvider", () => {
    class App {
      cache = $cache<string>({
        name: "foo",
        provider: DatabaseCacheProvider,
      });
    }
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    alepha.inject(App);
    expect(detectHasKV(alepha)).toBe(false);
  });

  it("is TRUE if at least ONE $cache lacks an explicit provider, even when others pin one", () => {
    class App {
      pinned = $cache<string>({
        name: "pinned",
        provider: DatabaseCacheProvider,
      });
      ambient = $cache<string>({ name: "ambient" });
    }
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    }).with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    alepha.inject(App);
    expect(detectHasKV(alepha)).toBe(true);
  });

  it("is FALSE for the bare api/users baseline (every internal $cache pins DatabaseCacheProvider)", async () => {
    // This is the property the whole rework is paying for: a saas using the
    // users module — and only the users module — must not trigger KV
    // provisioning on Cloudflare. If this test ever flips to `true`, somebody
    // either added an `$cache({})` somewhere in api/users or accidentally
    // dropped the explicit `provider: DatabaseCacheProvider` from one of the
    // existing intent caches.
    const { AlephaApiUsers } = await import("alepha/api/users");
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    }).with(AlephaApiUsers);
    expect(detectHasKV(alepha)).toBe(false);
  });
});

/**
 * Mirrors the inline check at `cli/platform/commands/platform.ts:1015-1022`
 * (`detectResources`'s `hasAnalytics`) — the live-boot path `alepha platform
 * up` actually runs, as opposed to `BuildManifestTask`, which only drives
 * `alepha build` / `--prebuilt` deploys. Both must agree on what a
 * `$analytics` primitive means, or `up` would build without the dataset
 * binding while a manifest-driven deploy of the same app carries it.
 *
 * Typed against a minimal duck-typed shape rather than a real `Alepha`
 * instance (unlike `detectHasKV` above): registering a real `$analytics`
 * dataset (now `alepha/api/analytics`, in this same package) would drag
 * providers and a database seam into a spec that only cares about the
 * detection expression. `alepha.primitives()` itself is just a string-keyed
 * lookup, so a fake is enough to exercise the exact expression this mirrors.
 */
const detectHasAnalytics = (alepha: { primitives(name: string): unknown[] }) =>
  alepha.primitives("$analytics").length > 0;

describe("platform.detectResources — hasAnalytics decision", () => {
  it("is false when no $analytics primitive is registered", () => {
    const alepha = Alepha.create();
    expect(detectHasAnalytics(alepha)).toBe(false);
  });

  it("is TRUE when a $analytics dataset is declared", () => {
    const fake = {
      primitives: (name: string) => (name === "$analytics" ? [{}] : []),
    };
    expect(detectHasAnalytics(fake)).toBe(true);
  });
});
