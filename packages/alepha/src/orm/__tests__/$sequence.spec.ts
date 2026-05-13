import { $inject, Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { $sequence } from "../core/primitives/$sequence.ts";
import { DatabaseProvider } from "../core/providers/drivers/DatabaseProvider.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

describe("$sequence", () => {
  class App {
    seq = $sequence();
    seq2 = $sequence({ startWith: 100, incrementBy: 2 });
    perCampaign = $sequence();
  }

  const alepha = Alepha.create().with(AlephaOrmPostgres);
  const app = alepha.inject(App);

  it("should generate sequential numbers", async () => {
    expect(await app.seq.next()).toBe(1);
    expect(await app.seq.next()).toBe(2);
    expect(await app.seq.next()).toBe(3);
    expect(await app.seq.current()).toBe(3);
    expect(await app.seq.next()).toBe(4);
  });

  it("should support custom start and increment options", async () => {
    expect(await app.seq2.next()).toBe(100);
    expect(await app.seq2.next()).toBe(102);
    expect(await app.seq2.next()).toBe(104);
    expect(await app.seq2.current()).toBe(104);
    expect(await app.seq2.next()).toBe(106);
  });

  it("should keep independent counters per scope", async () => {
    // Each scope starts from the same start value, independent of every other.
    expect(await app.perCampaign.next("campaign-1")).toBe(1);
    expect(await app.perCampaign.next("campaign-1")).toBe(2);
    expect(await app.perCampaign.next("campaign-2")).toBe(1);
    expect(await app.perCampaign.next("campaign-2")).toBe(2);
    expect(await app.perCampaign.next("campaign-1")).toBe(3);

    expect(await app.perCampaign.current("campaign-1")).toBe(3);
    expect(await app.perCampaign.current("campaign-2")).toBe(2);
    expect(await app.perCampaign.current("never-touched")).toBeNull();
  });

  it("should reset to an explicit value", async () => {
    await app.perCampaign.reset(42, "campaign-1");
    expect(await app.perCampaign.current("campaign-1")).toBe(42);
    expect(await app.perCampaign.next("campaign-1")).toBe(43);
  });
});

describe("$sequence inside $transactional", () => {
  /**
   * Sequence calls participate in the surrounding transaction (because they
   * route through Repository, which auto-joins `alepha.orm.tx`). This locks
   * the contract:
   *   - commit → counter advanced
   *   - rollback → counter unchanged (same value handed out on the next call)
   *
   * This is DIFFERENT from PG-native `nextval()` (which is tx-independent and
   * leaves gaps on rollback). The chosen semantics are intentional: in app
   * code, a failed insert that consumed a shortId should give the id back.
   */
  class App {
    seq = $sequence();
    db = $inject(DatabaseProvider);
  }

  const alepha = Alepha.create().with(AlephaOrmPostgres);
  const app = alepha.inject(App);

  it("commits the increment together with the surrounding tx", async () => {
    await app.db.transactional(async () => {
      const n = await app.seq.next("tx-commit");
      expect(n).toBe(1);
    });

    expect(await app.seq.current("tx-commit")).toBe(1);
    expect(await app.seq.next("tx-commit")).toBe(2);
  });

  it("rolls the increment back together with the surrounding tx", async () => {
    await expect(
      app.db.transactional(async () => {
        const n = await app.seq.next("tx-rollback");
        expect(n).toBe(1);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Counter unchanged — rolled back with the outer tx.
    expect(await app.seq.current("tx-rollback")).toBeNull();
    // Next call hands out the same value the rolled-back call saw.
    expect(await app.seq.next("tx-rollback")).toBe(1);
  });

  it("isolates rollbacks per scope", async () => {
    // Bump scope A first, outside any tx.
    expect(await app.seq.next("scope-a")).toBe(1);

    await expect(
      app.db.transactional(async () => {
        await app.seq.next("scope-a"); // → 2 in this tx
        await app.seq.next("scope-b"); // → 1 in this tx
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    // scope-a returns to its pre-tx value of 1.
    expect(await app.seq.current("scope-a")).toBe(1);
    // scope-b never persisted at all.
    expect(await app.seq.current("scope-b")).toBeNull();
  });
});
