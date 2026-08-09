import { z } from "alepha";
import { describe, expect, it } from "vitest";
import { AnalyticsSlotMap } from "../planner/AnalyticsSlotMap.ts";

describe("AnalyticsSlotMap", () => {
  const dataset = {
    name: "page_views",
    index: "app",
    dimensions: z.object({
      country: z.string(),
      app: z.string(),
      path: z.string(),
    }),
    measures: z.object({ count: z.number() }),
  };

  it("reserves blob1 for the dataset name and blob2 for the hour", () => {
    expect(AnalyticsSlotMap.KIND_SLOT).toBe(1);
    expect(AnalyticsSlotMap.HOUR_SLOT).toBe(2);
  });

  it("assigns dimension slots alphabetically, not in declaration order", () => {
    const map = AnalyticsSlotMap.forDataset(dataset);
    expect(map.blobSlot("app")).toBe(3);
    expect(map.blobSlot("country")).toBe(4);
    expect(map.blobSlot("path")).toBe(5);
  });

  it("is stable when dimensions are re-declared in a different order", () => {
    const reordered = {
      ...dataset,
      dimensions: z.object({
        path: z.string(),
        country: z.string(),
        app: z.string(),
      }),
    };
    const a = AnalyticsSlotMap.forDataset(dataset);
    const b = AnalyticsSlotMap.forDataset(reordered);
    for (const name of ["app", "country", "path"]) {
      expect(b.blobSlot(name)).toBe(a.blobSlot(name));
    }
  });

  it("assigns measure slots alphabetically from double1", () => {
    const map = AnalyticsSlotMap.forDataset({
      ...dataset,
      measures: z.object({ views: z.number(), bytes: z.number() }),
    });
    expect(map.doubleSlot("bytes")).toBe(1);
    expect(map.doubleSlot("views")).toBe(2);
  });

  it("rejects more than 18 dimensions", () => {
    const shape: Record<string, z.ZodNumber> = {};
    for (let i = 0; i < 19; i++)
      shape[`d${String(i).padStart(2, "0")}`] = z.number();
    expect(() =>
      AnalyticsSlotMap.forDataset({ ...dataset, dimensions: z.object(shape) }),
    ).toThrow(/at most 18 dimensions/);
  });

  it("rejects an index that is not a declared dimension", () => {
    expect(() =>
      AnalyticsSlotMap.forDataset({ ...dataset, index: "nope" }),
    ).toThrow(/'nope' is not a declared dimension/);
  });

  it("throws for an unknown dimension rather than returning a wrong slot", () => {
    const map = AnalyticsSlotMap.forDataset(dataset);
    expect(() => map.blobSlot("missing")).toThrow(
      /unknown dimension 'missing'/,
    );
  });
});
