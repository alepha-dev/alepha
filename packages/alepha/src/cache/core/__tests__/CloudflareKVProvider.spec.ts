import { Alepha } from "alepha";
import { AlephaLogger, MemoryDestinationProvider } from "alepha/logger";
import { beforeEach, describe, expect, it } from "vitest";
import { $cache } from "../index.ts";
import { CacheProvider } from "../providers/CacheProvider.ts";
import {
  CloudflareKVProvider,
  KV_DEFAULT_BINDING,
  type KVListResult,
  type KVPutOptions,
} from "../providers/CloudflareKVProvider.ts";

/**
 * Records what reached the KV binding, so the test can assert on the
 * `expirationTtl` the provider actually asked Cloudflare for.
 */
class FakeKV {
  public puts: Array<{ key: string; options?: KVPutOptions }> = [];
  protected store = new Map<string, ArrayBuffer | string>();

  async get(key: string, type?: "text" | "arrayBuffer"): Promise<any> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === "arrayBuffer" ? value : String(value);
  }

  async put(
    key: string,
    value: string | ArrayBuffer,
    options?: KVPutOptions,
  ): Promise<void> {
    this.puts.push({ key, options });
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<KVListResult> {
    return { keys: [], list_complete: true };
  }
}

describe("CloudflareKVProvider", () => {
  let kv: FakeKV;

  const boot = async () => {
    kv = new FakeKV();
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: CacheProvider, use: CloudflareKVProvider });

    class App {
      short = $cache({ name: "short", ttl: [5, "seconds"] });
      long = $cache({ name: "long", ttl: [10, "minutes"] });
    }

    const app = alepha.inject(App);
    alepha.store.set("cloudflare.env", { [KV_DEFAULT_BINDING]: kv });
    await alepha.start();
    return { alepha, app };
  };

  const warnings = (alepha: Alepha) =>
    alepha
      .inject(MemoryDestinationProvider)
      .logs.filter((it) => it.level === "WARN");

  beforeEach(() => {
    kv = new FakeKV();
  });

  describe("TTL clamping", () => {
    it("should warn when a TTL is widened to KV's 60-second floor", async () => {
      // KV genuinely refuses anything under 60s, so the clamp itself is
      // correct — but it was silent. A `$cache({ ttl: [5, "seconds"] })`
      // deployed to Workers served entries up to 12× staler than configured
      // and nothing anywhere said so.
      const { alepha, app } = await boot();

      await app.short.set("k", "v" as any);

      expect(kv.puts.at(-1)?.options?.expirationTtl).toBe(60);
      const warned = warnings(alepha);
      expect(warned).toHaveLength(1);
      expect(warned[0].message).toMatch(/60/);
      expect(warned[0].message).toMatch(/short/);
    });

    it("should leave a TTL above the floor alone and stay quiet", async () => {
      const { alepha, app } = await boot();

      await app.long.set("k", "v" as any);

      expect(kv.puts.at(-1)?.options?.expirationTtl).toBe(600);
      expect(warnings(alepha)).toHaveLength(0);
    });

    it("should warn once, not on every write", async () => {
      // The clamp is a static consequence of configuration, so repeating it
      // per write would drown the log on a hot cache.
      const { alepha, app } = await boot();

      await app.short.set("a", "v" as any);
      await app.short.set("b", "v" as any);
      await app.short.set("c", "v" as any);

      expect(kv.puts).toHaveLength(3);
      expect(warnings(alepha)).toHaveLength(1);
    });
  });
});
