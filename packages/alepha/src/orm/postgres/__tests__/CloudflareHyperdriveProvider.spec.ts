import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { CloudflareHyperdriveProvider } from "../providers/CloudflareHyperdriveProvider.ts";

/**
 * Exposes the two module functions the real provider imports at `start`, so
 * the test can count how many postgres clients the `db` getter opens without
 * needing a database.
 */
class TestHyperdriveProvider extends CloudflareHyperdriveProvider {
  public clientsOpened = 0;
  public clientsClosed = 0;

  public readonly alsProvider = this.als;

  public prepare(): void {
    this.bindingName = "HYPERDRIVE";
    this.postgresFn = () => {
      this.clientsOpened++;
      return { end: async () => void this.clientsClosed++ };
    };
    this.drizzleFn = (client: any) => ({ client });
  }
}

describe("CloudflareHyperdriveProvider", () => {
  const boot = async () => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "hyperdrive://HYPERDRIVE" },
    });
    const provider = alepha.inject(TestHyperdriveProvider);
    alepha.store.set("cloudflare.env", {
      HYPERDRIVE: { connectionString: "postgres://localhost/test" },
    });
    provider.prepare();
    return { alepha, provider };
  };

  describe("client lifetime", () => {
    it("should open one client per request, not one per access", async () => {
      // Workers cannot reuse an I/O object across request contexts, so a
      // fresh client per REQUEST is deliberate. Per ACCESS is not: `db` is
      // touched at least once per repository call, so a handler doing five
      // queries opened five postgres clients — none of them closed, and none
      // of them able to share a statement cache.
      const { alepha, provider } = await boot();

      await alepha.fork(async () => {
        provider.db;
        provider.db;
        provider.db;
      });

      expect(provider.clientsOpened).toBe(1);
    });

    it("should open a separate client for each request", async () => {
      // The flip side: memoising process-wide would hand request B the I/O
      // object request A created — exactly the error the per-request design
      // exists to avoid.
      const { alepha, provider } = await boot();

      await alepha.fork(async () => {
        provider.db;
      });
      await alepha.fork(async () => {
        provider.db;
      });

      expect(provider.clientsOpened).toBe(2);
    });

    it("should not memoise outside a request context", async () => {
      // No fork means no request boundary to scope the cache to — caching at
      // app level would leak one request's client into the next.
      const { provider } = await boot();
      expect(provider.alsProvider.exists()).toBe(false);

      provider.db;
      provider.db;

      expect(provider.clientsOpened).toBe(2);
    });
  });
});
