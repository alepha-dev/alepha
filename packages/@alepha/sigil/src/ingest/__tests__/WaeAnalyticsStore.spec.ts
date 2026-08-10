import { AnalyticsEngineSql, FakeAnalyticsEngine } from "@alepha/analytics";
import { describe, expect, it } from "vitest";
import { WaeAnalyticsStore } from "../WaeAnalyticsStore.ts";
import { analyticsStoreConformanceTests } from "./analyticsStoreConformance.ts";

const A = "11111111-1111-4111-8111-111111111111";

/**
 * Build the composite over a fake dataset + fake SQL API. `sql` is an
 * `AnalyticsEngineSql` whose `query` is swapped for the fake's — the real
 * class's static helpers (`quote`, `num`, `str`) stay in play, so quoting and
 * coercion are exercised rather than stubbed.
 */
const createStore = (): {
  store: WaeAnalyticsStore;
  fake: FakeAnalyticsEngine;
} => {
  const fake = new FakeAnalyticsEngine();
  const sql = new AnalyticsEngineSql({ accountId: "acct", token: "tok" });
  sql.query = fake.query;
  const store = new WaeAnalyticsStore({
    dataset: fake.dataset,
    datasetName: "sigil_analytics",
    sql,
    uniques: fake.uniques,
  });
  return { store, fake };
};

analyticsStoreConformanceTests("wae (composite)", () => createStore().store);

describe("WaeAnalyticsStore — the parts a conformance spec cannot see", () => {
  it("corrects every count by _sample_interval, never bare count()", async () => {
    const { store, fake } = createStore();
    await store.absorb({
      views: [
        {
          sigilId: A,
          hour: "2026-08-02T10",
          path: "/",
          country: "FR",
          count: 1,
        },
      ],
    });
    const window = { sigilIds: [A], since: "2026-08-01" };
    await store.totalViews(window);
    await store.timeline(window);
    await store.topPaths(window, 10);
    await store.vitalHistograms(window);

    // The fake gives every point an interval of 1, so a query that dropped the
    // multiplication would still return the right number and pass every
    // behavioural assertion. Only the statement text can catch it — and it is
    // the difference between a real total and a tenth of one in production.
    expect(fake.queries).toHaveLength(4);
    for (const query of fake.queries) {
      expect(query).toContain("_sample_interval");
      expect(query).not.toMatch(/\bcount\(/);
    }
  });

  it("never sends a visitor hash to Analytics Engine", async () => {
    const { store, fake } = createStore();
    await store.absorb({
      uniques: [{ sigilId: A, day: "2026-08-02", visitorHash: "secret-hash" }],
    });

    // The whole reason this store is a composite. A hash reaching a dataset
    // with no delete API and a fixed retention would be unerasable personal
    // data, which is a worse failure than a wrong number.
    expect(fake.points).toHaveLength(0);
    const serialized = JSON.stringify(fake.points);
    expect(serialized).not.toContain("secret-hash");
    expect(fake.uniques.sawVisitor(A, "2026-08-02", "secret-hash")).toBe(true);
  });

  it("writes the caller's hour bucket rather than relying on write time", async () => {
    const { store, fake } = createStore();
    await store.absorb({
      views: [
        // Deliberately an hour in the past: a batched envelope or a retry
        // arrives late, and WAE cannot backdate `timestamp`.
        {
          sigilId: A,
          hour: "2026-08-02T10",
          path: "/",
          country: "FR",
          count: 1,
        },
      ],
    });

    expect(fake.points[0].blobs).toEqual(["v", "/", "FR", "2026-08-02T10"]);
  });

  it("tells views and vitals apart by an explicit kind marker", async () => {
    const { store, fake } = createStore();
    await store.absorb({
      views: [
        {
          sigilId: A,
          hour: "2026-08-02T10",
          path: "/",
          country: "FR",
          count: 1,
        },
      ],
      vitals: [
        {
          sigilId: A,
          hour: "2026-08-02T10",
          metric: "lcp",
          path: "/",
          bucket: 2,
          count: 1,
        },
      ],
    });

    // One dataset holds both kinds — Analytics Engine has no table concept —
    // so the marker is what keeps a vitals row out of the view totals.
    expect(fake.points.map((p) => p.blobs[0])).toEqual(["v", "p"]);
    const window = { sigilIds: [A], since: "2026-08-01" };
    expect(await store.totalViews(window)).toBe(1);
  });
});

describe("AnalyticsEngineSql.quote", () => {
  it("escapes quotes and backslashes, because there is no bind protocol", () => {
    // The SQL API takes a plain-text body: every literal is concatenated into
    // the statement, so this is the only place injection can be stopped.
    expect(AnalyticsEngineSql.quote("o'brien")).toBe("'o\\'brien'");
    expect(AnalyticsEngineSql.quote("a\\b")).toBe("'a\\\\b'");
  });

  it("refuses a non-finite number rather than emitting NaN into a query", () => {
    expect(() => AnalyticsEngineSql.quote(Number.NaN)).toThrow();
    expect(() => AnalyticsEngineSql.quote(Number.POSITIVE_INFINITY)).toThrow();
  });
});
