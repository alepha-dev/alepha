import { Alepha, z } from "alepha";
import { BadRequestError, NotFoundError } from "alepha/server";
import { describe, expect, it } from "vitest";

// Import through `../index.ts`, not the primitive file: evaluating the module
// const is what tags `$analytics` with `AlephaApiAnalytics`, whose `register()`
// binds `MemoryAnalyticsProvider` in test mode. Importing the primitive
// directly leaves the abstract `AnalyticsProvider` seam unbound.
import { $analytics } from "../index.ts";
import { AdminAnalyticsService } from "../services/AdminAnalyticsService.ts";

class TestDatasets {
  public readonly views = $analytics({
    name: "page_views",
    index: "app",
    dimensions: z.object({ app: z.text(), path: z.text() }),
    measures: z.object({ count: z.number() }),
    slots: { dimensions: ["app", "path"], measures: ["count"] },
  });
}

const setup = async () => {
  const alepha = Alepha.create();
  const datasets = alepha.inject(TestDatasets);
  const service = alepha.inject(AdminAnalyticsService);
  await alepha.start();
  return { datasets, service };
};

/**
 * Two datasets, only one of which carries the dimension the scoped surface
 * pins on. That asymmetry is the point: a dataset with no `app` cannot be
 * narrowed to one app, so it must not be offered rather than be offered
 * unscoped.
 */
class TestScopedDatasets {
  public readonly scoped = $analytics({
    name: "scoped_views",
    index: "app",
    dimensions: z.object({ app: z.text(), path: z.text() }),
    measures: z.object({ count: z.number() }),
    slots: { dimensions: ["app", "path"], measures: ["count"] },
  });

  public readonly unscoped = $analytics({
    name: "global_stats",
    index: "region",
    dimensions: z.object({ region: z.text() }),
    measures: z.object({ count: z.number() }),
    slots: { dimensions: ["region"], measures: ["count"] },
  });
}

const setupScoped = async () => {
  const alepha = Alepha.create();
  const datasets = alepha.inject(TestScopedDatasets);
  const service = alepha.inject(AdminAnalyticsService);
  await alepha.start();
  return { datasets, service };
};

describe("AdminAnalyticsService", () => {
  it("lists declared datasets as JSON-Schema descriptors", async () => {
    const { service } = await setup();
    const list = service.listDatasets();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("page_views");
    expect(list[0].index).toBe("app");
    expect(list[0].dimensions.properties).toHaveProperty("app");
    expect(list[0].dimensions.properties).toHaveProperty("path");
    expect(list[0].measures.properties).toHaveProperty("count");
  });

  it("refuses a query on an unknown dataset", async () => {
    const { service } = await setup();
    await expect(
      service.queryDataset("nope", {
        since: "2026-01-01",
        select: { count: "sum" },
      }),
    ).rejects.toThrowError(NotFoundError);
  });

  it("refuses a filter on an undeclared dimension", async () => {
    const { service } = await setup();
    await expect(
      service.queryDataset("page_views", {
        since: "2026-01-01",
        where: { hacker: "x" },
        select: { count: "sum" },
      }),
    ).rejects.toThrowError(BadRequestError);
  });

  it("refuses groupBy outside declared dimensions + hour/day", async () => {
    const { service } = await setup();
    await expect(
      service.queryDataset("page_views", {
        since: "2026-01-01",
        groupBy: ["count"],
        select: { count: "sum" },
      }),
    ).rejects.toThrowError(BadRequestError);
  });

  it("allows groupBy on the hour and day pseudo-dimensions", async () => {
    const { service } = await setup();
    const result = await service.queryDataset("page_views", {
      since: "2026-01-01",
      groupBy: ["day"],
      select: { count: "sum" },
    });
    expect(result.rows).toEqual([]);
  });

  it("refuses select on an undeclared measure", async () => {
    const { service } = await setup();
    await expect(
      service.queryDataset("page_views", {
        since: "2026-01-01",
        select: { app: "sum" },
      }),
    ).rejects.toThrowError(BadRequestError);
  });

  it("runs a valid query through the bound provider", async () => {
    const { datasets, service } = await setup();
    await datasets.views.record({
      app: "lore",
      path: "/",
      count: 2,
      hour: "2026-08-01T10",
    });
    const result = await service.queryDataset("page_views", {
      since: "2026-01-01",
      groupBy: ["path"],
      select: { count: "sum" },
    });
    expect(result.rows).toEqual([{ path: "/", count: 2 }]);
    expect(result.estimated).toBe(false);
  });

  /**
   * The scoped surface: a caller that may only ever see one slice of a
   * dataset. The pin is enforced here rather than by whoever builds the
   * query, because this is the only place that can refuse the keys the
   * descriptor does not publish.
   */
  describe("pinned scope", () => {
    it("omits a pinned dimension from the published descriptor", async () => {
      const { service } = await setupScoped();
      const list = service.listDatasets({ pin: { app: "lore" } });
      const scoped = list.find((entry) => entry.name === "scoped_views");
      expect(scoped?.dimensions.properties).not.toHaveProperty("app");
      expect(scoped?.dimensions.properties).toHaveProperty("path");
    });

    it("drops a dataset that does not declare every pinned dimension", async () => {
      const { service } = await setupScoped();
      const list = service.listDatasets({ pin: { app: "lore" } });
      expect(list.map((entry) => entry.name)).toEqual(["scoped_views"]);
    });

    it("forces the pinned clause onto the query", async () => {
      const { datasets, service } = await setupScoped();
      await datasets.scoped.record({
        app: "lore",
        path: "/",
        count: 2,
        hour: "2026-08-01T10",
      });
      await datasets.scoped.record({
        app: "other",
        path: "/",
        count: 7,
        hour: "2026-08-01T10",
      });

      const result = await service.queryDataset(
        "scoped_views",
        { since: "2026-01-01", groupBy: ["path"], select: { count: "sum" } },
        { pin: { app: "lore" } },
      );

      expect(result.rows).toEqual([{ path: "/", count: 2 }]);
    });

    it("refuses a where clause on a pinned dimension", async () => {
      const { service } = await setupScoped();
      await expect(
        service.queryDataset(
          "scoped_views",
          {
            since: "2026-01-01",
            where: { app: "other" },
            select: { count: "sum" },
          },
          { pin: { app: "lore" } },
        ),
      ).rejects.toThrowError(BadRequestError);
    });

    it("refuses groupBy on a pinned dimension", async () => {
      const { service } = await setupScoped();
      await expect(
        service.queryDataset(
          "scoped_views",
          {
            since: "2026-01-01",
            groupBy: ["app"],
            select: { count: "sum" },
          },
          { pin: { app: "lore" } },
        ),
      ).rejects.toThrowError(BadRequestError);
    });

    it("refuses a query on a dataset the pin cannot narrow", async () => {
      const { service } = await setupScoped();
      await expect(
        service.queryDataset(
          "global_stats",
          { since: "2026-01-01", select: { count: "sum" } },
          { pin: { app: "lore" } },
        ),
      ).rejects.toThrowError(NotFoundError);
    });
  });
});
