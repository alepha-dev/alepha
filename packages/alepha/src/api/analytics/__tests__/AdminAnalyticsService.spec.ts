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
  });
}

const setup = async () => {
  const alepha = Alepha.create();
  const datasets = alepha.inject(TestDatasets);
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
});
