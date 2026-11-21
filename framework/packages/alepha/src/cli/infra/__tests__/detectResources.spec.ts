import { Alepha } from "alepha";
import { $cache, CacheProvider, MemoryCacheProvider } from "alepha/cache";
import { DatabaseCacheProvider } from "alepha/cache/database";
import { describe, expect, it } from "vitest";

import { InfraCommand } from "../commands/infra.ts";

/**
 * Reaches the protected `detectResources`, the live-boot detection `alepha
 * infra plan` and `alepha deploy` run on the app's own container.
 */
class TestInfraCommand extends InfraCommand {
  public readonly testDetectResources = this.detectResources.bind(this);
}

/**
 * `detectResources` on an app container. `BuildManifestTask` holds the twin
 * of each rule: a manifest-driven deploy reads that one, and the two have to
 * agree.
 */
const detect = (app: unknown) =>
  Alepha.create().inject(TestInfraCommand).testDetectResources(app);

const detectHasKV = (app: Alepha): boolean => detect(app).hasKV;

describe("InfraCommand.detectResources, the hasKV decision", () => {
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

  /**
   * ⚠️ Read the container this builds: it pins `DatabaseCacheProvider` on one
   * `$cache`, which puts that provider in the registry - so the rule below
   * answers false on the FIRST clause and never reaches the filter. That is
   * correct rather than incidental (an app with the database cache registered
   * has no use for a namespace), but it means the "one ambient cache is
   * enough" property has to be tested somewhere the database cache is absent,
   * which is the test after it.
   */
  it("is FALSE once the database cache is in the container, ambient cache or not", () => {
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
    expect(detectHasKV(alepha)).toBe(false);
  });

  it("is TRUE if at least ONE $cache lacks an explicit provider, with no database cache", () => {
    class App {
      pinned = $cache<string>({ name: "pinned", provider: "memory" });
      ambient = $cache<string>({ name: "ambient" });
    }
    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    alepha.inject(App);
    expect(detectHasKV(alepha)).toBe(true);
  });

  it("is FALSE for the bare api/users baseline", async () => {
    // This is the property the whole rework is paying for: a saas using the
    // users module  -  and only the users module  -  must not trigger KV
    // provisioning on Cloudflare.
    //
    // It now holds for two independent reasons, and that is deliberate
    // belt-and-braces rather than redundancy to tidy up. `api/users` imports
    // `alepha/cache/database`, so the first clause answers it; and every
    // internal `$cache` still pins `DatabaseCacheProvider`, so the filter
    // would answer it too. The pins stay because on NODE the default is
    // `MemoryCacheProvider`, and a password-reset rate limit that resets on
    // restart and does not span replicas is not a rate limit.
    const { AlephaApiUsers } = await import("alepha/api/users");
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    }).with(AlephaApiUsers);
    expect(detectHasKV(alepha)).toBe(false);
  });

  /**
   * The flip #Q2151 is actually paying for, pinned rather than described.
   *
   * `DeviceCodeService` declares three `$cache` with no `provider` at all, so
   * the filter on its own answers TRUE and every OAuth-speaking Cloudflare
   * app was provisioned a KV namespace. Both halves are asserted here: the
   * old rule still says true, and the rule as a whole says false. A change
   * that made the first line false would make the second pass for the wrong
   * reason and leave this test looking green.
   */
  it("is FALSE for an OAuth app whose ambient caches used to force KV", async () => {
    const { AlephaOAuth } = await import("alepha/api/oauth");
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    }).with(AlephaOAuth);

    const ambient = alepha
      .primitives("cache")
      .filter((it: any) => it.options?.provider == null);

    expect(ambient.length).toBeGreaterThan(0);
    expect(detectHasKV(alepha)).toBe(false);
  });
});

/**
 * The `hasAnalytics` rule of the same method.
 *
 * The app is a real container whose `primitives()` answers one `$analytics`
 * dataset: registering a real one (`alepha/api/analytics`) would drag
 * providers and a database seam into a spec that only cares about the
 * detection.
 */
const withAnalyticsDataset = () => {
  const real = Alepha.create();
  return {
    inject: real.inject.bind(real),
    primitives: (name: string) =>
      name === "$analytics" ? [{}] : real.primitives(name),
  };
};

describe("InfraCommand.detectResources, the hasAnalytics decision", () => {
  it("is false when no $analytics primitive is registered", () => {
    expect(detect(Alepha.create()).hasAnalytics).toBe(false);
  });

  it("is TRUE when a $analytics dataset is declared", () => {
    expect(detect(withAnalyticsDataset()).hasAnalytics).toBe(true);
  });
});
