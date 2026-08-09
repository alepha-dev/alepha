import { describe, expect, it } from "vitest";
import type { AnalyticsStore } from "../AnalyticsStore.ts";

/**
 * Behaviour every {@link AnalyticsStore} has to exhibit, run against each
 * implementation.
 *
 * ## Why this exists at all
 *
 * The design accepts that two backends answering the same questions will not
 * answer with the same *numbers* — Workers Analytics Engine samples, and the
 * orm store does not, so identical traffic yields different totals on
 * Cloudflare than on a Node deployment. That divergence is the standing price
 * of the split and is not a bug.
 *
 * What is emphatically NOT accepted is a **behavioural** divergence: a store
 * that counts a returning visitor twice, or leaks another app's rows into a
 * window, or orders a leaderboard the other way. This spec pins those, and
 * nothing that a sampler could legitimately perturb.
 *
 * Every assertion below therefore uses volumes small enough that any sane
 * sampler passes them through untouched, and asserts ordering and identity
 * rather than exact large sums.
 */
export const analyticsStoreConformanceTests = (
  name: string,
  createStore: () => Promise<AnalyticsStore> | AnalyticsStore,
): void => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const SINCE = "2026-08-01";

  describe(`AnalyticsStore conformance — ${name}`, () => {
    it("sums repeat views of the same path into one bucket", async () => {
      const store = await createStore();
      await store.absorb({
        views: [
          {
            sigilId: A,
            hour: "2026-08-02T10",
            path: "/",
            country: "FR",
            count: 2,
          },
          {
            sigilId: A,
            hour: "2026-08-02T11",
            path: "/",
            country: "FR",
            count: 3,
          },
        ],
      });

      expect(await store.totalViews({ sigilIds: [A], since: SINCE })).toBe(5);
    });

    it("counts a repeat visitor once, on any number of absorbs", async () => {
      const store = await createStore();
      await store.absorb({
        uniques: [{ sigilId: A, day: "2026-08-02", visitorHash: "h1" }],
      });
      // Same person, same day, second envelope — the conflict is the EXPECTED
      // case on this table, not an error, and it must not raise the count.
      await store.absorb({
        uniques: [
          { sigilId: A, day: "2026-08-02", visitorHash: "h1" },
          { sigilId: A, day: "2026-08-02", visitorHash: "h2" },
        ],
      });

      expect(await store.uniqueVisitors({ sigilIds: [A], since: SINCE })).toBe(
        2,
      );
    });

    it("counts one person across two of a project's apps as one visitor", async () => {
      const store = await createStore();
      await store.absorb({
        uniques: [
          { sigilId: A, day: "2026-08-02", visitorHash: "same" },
          { sigilId: B, day: "2026-08-02", visitorHash: "same" },
        ],
      });

      // The whole reason `uniqueVisitors` takes the id list rather than being
      // summed per app by the caller: only the store can see that these two
      // rows are one person.
      expect(
        await store.uniqueVisitors({ sigilIds: [A, B], since: SINCE }),
      ).toBe(1);
    });

    it("counts the same hash on two different days as two visitors", async () => {
      const store = await createStore();
      await store.absorb({
        uniques: [
          { sigilId: A, day: "2026-08-02", visitorHash: "h1" },
          { sigilId: A, day: "2026-08-03", visitorHash: "h1" },
        ],
      });

      expect(await store.uniqueVisitors({ sigilIds: [A], since: SINCE })).toBe(
        2,
      );
    });

    it("excludes everything outside the window and outside the id list", async () => {
      const store = await createStore();
      await store.absorb({
        views: [
          {
            sigilId: A,
            hour: "2026-07-30T10",
            path: "/old",
            country: "FR",
            count: 9,
          },
          {
            sigilId: A,
            hour: "2026-08-02T10",
            path: "/in",
            country: "FR",
            count: 1,
          },
          {
            sigilId: B,
            hour: "2026-08-02T10",
            path: "/other",
            country: "FR",
            count: 7,
          },
        ],
        uniques: [
          { sigilId: A, day: "2026-07-30", visitorHash: "old" },
          { sigilId: B, day: "2026-08-02", visitorHash: "other" },
        ],
      });

      const window = { sigilIds: [A], since: SINCE };
      expect(await store.totalViews(window)).toBe(1);
      expect(await store.uniqueVisitors(window)).toBe(0);
      expect((await store.topPaths(window, 10)).map((r) => r.key)).toEqual([
        "/in",
      ]);
    });

    it("returns an empty answer for an empty id list rather than everything", async () => {
      const store = await createStore();
      await store.absorb({
        views: [
          {
            sigilId: A,
            hour: "2026-08-02T10",
            path: "/",
            country: "FR",
            count: 4,
          },
        ],
      });

      // A project with no enrolled apps must not read as "no filter".
      const window = { sigilIds: [], since: SINCE };
      expect(await store.totalViews(window)).toBe(0);
      expect(await store.uniqueVisitors(window)).toBe(0);
      expect(await store.topPaths(window, 10)).toEqual([]);
      expect(await store.timeline(window)).toEqual([]);
    });

    it("orders leaderboards by count, descending, and honours the limit", async () => {
      const store = await createStore();
      await store.absorb({
        views: [
          {
            sigilId: A,
            hour: "2026-08-02T10",
            path: "/a",
            country: "FR",
            count: 1,
          },
          {
            sigilId: A,
            hour: "2026-08-02T10",
            path: "/b",
            country: "DE",
            count: 5,
          },
          {
            sigilId: A,
            hour: "2026-08-02T10",
            path: "/c",
            country: "ES",
            count: 3,
          },
        ],
      });

      const window = { sigilIds: [A], since: SINCE };
      expect((await store.topPaths(window, 2)).map((r) => r.key)).toEqual([
        "/b",
        "/c",
      ]);
      expect((await store.topCountries(window, 3)).map((r) => r.key)).toEqual([
        "DE",
        "ES",
        "FR",
      ]);
    });

    it("groups the timeline by UTC day, folding the hours inside it", async () => {
      const store = await createStore();
      await store.absorb({
        views: [
          {
            sigilId: A,
            hour: "2026-08-02T01",
            path: "/",
            country: "FR",
            count: 1,
          },
          {
            sigilId: A,
            hour: "2026-08-02T23",
            path: "/",
            country: "FR",
            count: 2,
          },
          {
            sigilId: A,
            hour: "2026-08-03T05",
            path: "/",
            country: "FR",
            count: 4,
          },
        ],
      });

      // Days with no views may be omitted — the caller zero-fills — so this
      // asserts what IS there, not the length.
      const timeline = await store.timeline({ sigilIds: [A], since: SINCE });
      const byDate = new Map(timeline.map((p) => [p.date, p.views]));
      expect(byDate.get("2026-08-02")).toBe(3);
      expect(byDate.get("2026-08-03")).toBe(4);
    });

    it("merges vitals histograms across sigils and paths, per metric", async () => {
      const store = await createStore();
      await store.absorb({
        vitals: [
          {
            sigilId: A,
            hour: "2026-08-02T10",
            metric: "lcp",
            path: "/",
            bucket: 1,
            count: 2,
          },
          {
            sigilId: A,
            hour: "2026-08-02T11",
            metric: "lcp",
            path: "/x",
            bucket: 1,
            count: 1,
          },
          {
            sigilId: B,
            hour: "2026-08-02T10",
            metric: "lcp",
            path: "/",
            bucket: 4,
            count: 5,
          },
          {
            sigilId: A,
            hour: "2026-08-02T10",
            metric: "cls",
            path: "/",
            bucket: 0,
            count: 7,
          },
        ],
      });

      const histograms = await store.vitalHistograms({
        sigilIds: [A, B],
        since: SINCE,
      });
      // Bucket level, not percentile level: the p75 of two distributions is
      // not the mean of their p75s, which is why the interface returns these
      // and `summariseVitals` does the walk once for everyone.
      expect(histograms.lcp?.get(1)).toBe(3);
      expect(histograms.lcp?.get(4)).toBe(5);
      expect(histograms.cls?.get(0)).toBe(7);
      // A metric nobody reported is absent, not an empty histogram — the
      // caller renders `null` for it rather than a p75 of nothing.
      expect(histograms.inp).toBeUndefined();
    });

    it("keeps vitals buckets separate from each other when both are absorbed at once", async () => {
      const store = await createStore();
      await store.absorb({
        vitals: [
          {
            sigilId: A,
            hour: "2026-08-02T10",
            metric: "inp",
            path: "/",
            bucket: 0,
            count: 1,
          },
          {
            sigilId: A,
            hour: "2026-08-02T10",
            metric: "inp",
            path: "/",
            bucket: 6,
            count: 1,
          },
        ],
      });

      // Same row key, two buckets, one statement. The read-modify-write this
      // replaced could lose one of them.
      const histograms = await store.vitalHistograms({
        sigilIds: [A],
        since: SINCE,
      });
      expect(histograms.inp?.get(0)).toBe(1);
      expect(histograms.inp?.get(6)).toBe(1);
    });

    it("accepts an empty batch without touching anything", async () => {
      const store = await createStore();
      await store.absorb({});
      await store.absorb({ views: [], uniques: [], vitals: [] });

      expect(await store.totalViews({ sigilIds: [A], since: SINCE })).toBe(0);
    });
  });
};
