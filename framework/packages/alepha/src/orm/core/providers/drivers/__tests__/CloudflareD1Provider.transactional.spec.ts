import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { DbTransactionUnsupportedError } from "../../../errors/DbTransactionUnsupportedError.ts";
import { CloudflareD1Provider } from "../CloudflareD1Provider.ts";
import { DatabaseProvider } from "../DatabaseProvider.ts";
import { FakeD1 } from "./fakeD1.ts";

/**
 * D1 has no interactive transactions, so a `$transactional()` block there is
 * refused instead of running as a no-op that looks like a guarantee.
 *
 * The middleware calls `provider.transactional(fn, options, owner)` with one
 * `owner` per primitive, so these specs call it the same way: an `owner`
 * means "this came from `$transactional()`", none means an internal caller.
 */
const boot = async () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "d1://DB", ALEPHA_SERVERLESS: true },
  }).with({ provide: DatabaseProvider, use: CloudflareD1Provider });

  alepha.store.set("cloudflare.env", { DB: new FakeD1() });
  await alepha.start();

  return alepha.inject(DatabaseProvider);
};

describe("CloudflareD1Provider transactional", () => {
  it("refuses a $transactional block, and never runs its body", async ({
    expect,
  }) => {
    const provider = await boot();
    let ran = false;

    await expect(
      provider.transactional(
        async () => {
          ran = true;
        },
        undefined,
        {},
      ),
    ).rejects.toThrow(DbTransactionUnsupportedError);
    expect(ran).toBe(false);
  });

  it("names the alternatives and the opt-in in its message", async ({
    expect,
  }) => {
    const provider = await boot();

    await expect(
      provider.transactional(async () => {}, undefined, {}),
    ).rejects.toThrow(/d1 driver.*db\.version\(\).*allowNonAtomic/s);
  });

  it("runs the block in place with allowNonAtomic", async ({ expect }) => {
    const provider = await boot();

    const result = await provider.transactional(
      async () => "done",
      { allowNonAtomic: true },
      {},
    );

    expect(result).toBe("done");
  });

  it("leaves an internal caller with no owner running in place", async ({
    expect,
  }) => {
    const provider = await boot();

    expect(await provider.transactional(async () => 42)).toBe(42);
  });
});
