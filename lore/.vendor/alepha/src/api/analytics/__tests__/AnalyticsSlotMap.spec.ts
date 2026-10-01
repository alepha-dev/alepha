import type { ZType } from "alepha";
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
    slots: {
      dimensions: ["app", "country", "path"],
      measures: ["count"],
    },
  };

  it("reserves blob1 for the dataset name and blob2 for the hour", () => {
    expect(AnalyticsSlotMap.KIND_SLOT).toBe(1);
    expect(AnalyticsSlotMap.HOUR_SLOT).toBe(2);
  });

  it("assigns dimension slots from the pinned order, starting at blob3", () => {
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

  /**
   * The regression this class was rewritten for. Adding `referrer` to Lore's
   * `sigil_views` under the old alphabetical derivation pushed `sigilId` from
   * `blob5` to `blob8` and made eight days of stored views match no filter,
   * unrepairably: Analytics Engine has no update or delete API.
   *
   * The new dimension sorts in the MIDDLE of the existing ones on purpose: a
   * guard that only adds a name sorting last would pass under the old
   * derivation too.
   */
  it("does not move an existing slot when a dimension is appended", () => {
    const before = AnalyticsSlotMap.forDataset(dataset);
    const after = AnalyticsSlotMap.forDataset({
      ...dataset,
      dimensions: z.object({
        ...dataset.dimensions.shape,
        // Sorts between `country` and `path`.
        device: z.string(),
      }),
      slots: {
        ...dataset.slots,
        dimensions: [...dataset.slots.dimensions, "device"],
      },
    });

    for (const name of ["app", "country", "path"]) {
      expect(after.blobSlot(name)).toBe(before.blobSlot(name));
    }
    expect(after.blobSlot("device")).toBe(6);
  });

  it("does not move an existing slot when a measure is prepended by name", () => {
    const before = AnalyticsSlotMap.forDataset(dataset);
    const after = AnalyticsSlotMap.forDataset({
      ...dataset,
      // `bytes` sorts before `count`.
      measures: z.object({ count: z.number(), bytes: z.number() }),
      slots: { ...dataset.slots, measures: ["count", "bytes"] },
    });

    expect(after.doubleSlot("count")).toBe(before.doubleSlot("count"));
    expect(after.doubleSlot("bytes")).toBe(2);
  });

  it("keeps a retired name's slot reserved so nothing after it moves", () => {
    const map = AnalyticsSlotMap.forDataset({
      ...dataset,
      dimensions: z.object({ app: z.string(), path: z.string() }),
    });

    expect(map.blobSlot("app")).toBe(3);
    expect(map.blobSlot("path")).toBe(5);
    // Retired: it holds its position and nothing else.
    expect(map.dimensionNames).toEqual(["app", "path"]);
    expect(() => map.blobSlot("country")).toThrow(/unknown dimension/);
  });

  it("refuses a declared dimension that no slot claims", () => {
    expect(() =>
      AnalyticsSlotMap.forDataset({
        ...dataset,
        dimensions: z.object({
          ...dataset.dimensions.shape,
          device: z.string(),
        }),
      }),
    ).toThrow(/'device' with no slot/);
  });

  /**
   * A rename is the case the message has to handle well: appending the new
   * name reads old rows as empty, which is a gap; reusing the old slot reads
   * them as the new dimension, which is garbage. The error says so.
   */
  it("refuses a renamed dimension and names both ways out", () => {
    expect(() =>
      AnalyticsSlotMap.forDataset({
        ...dataset,
        index: "application",
        dimensions: z.object({
          application: z.string(),
          country: z.string(),
          path: z.string(),
        }),
      }),
    ).toThrow(/If this is a RENAME/);
  });

  it("refuses a declared measure that no slot claims", () => {
    expect(() =>
      AnalyticsSlotMap.forDataset({
        ...dataset,
        measures: z.object({ count: z.number(), bytes: z.number() }),
      }),
    ).toThrow(/'bytes' with no slot/);
  });

  it("refuses a name pinned twice", () => {
    expect(() =>
      AnalyticsSlotMap.forDataset({
        ...dataset,
        slots: { ...dataset.slots, dimensions: ["app", "country", "app"] },
      }),
    ).toThrow(/pins 'app' twice/);
  });

  it("rejects more than 18 dimension slots", () => {
    const shape: Record<string, ZType> = {};
    const pins: string[] = [];
    for (let i = 0; i < 19; i++) {
      const name = `d${String(i).padStart(2, "0")}`;
      shape[name] = z.number();
      pins.push(name);
    }
    expect(() =>
      AnalyticsSlotMap.forDataset({
        ...dataset,
        index: "d00",
        dimensions: z.object(shape),
        slots: { ...dataset.slots, dimensions: pins },
      }),
    ).toThrow(/at most 18/);
  });

  it("rejects more than 20 measure slots", () => {
    const shape: Record<string, ZType> = {};
    const pins: string[] = [];
    for (let i = 0; i < 21; i++) {
      const name = `m${String(i).padStart(2, "0")}`;
      shape[name] = z.number();
      pins.push(name);
    }
    expect(() =>
      AnalyticsSlotMap.forDataset({
        ...dataset,
        measures: z.object(shape),
        slots: { ...dataset.slots, measures: pins },
      }),
    ).toThrow(/at most 20/);
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

  it("assigns measure slots from the pinned order, starting at double1", () => {
    const map = AnalyticsSlotMap.forDataset({
      ...dataset,
      measures: z.object({ views: z.number(), bytes: z.number() }),
      slots: { ...dataset.slots, measures: ["bytes", "views"] },
    });
    expect(map.doubleSlot("bytes")).toBe(1);
    expect(map.doubleSlot("views")).toBe(2);
  });
});
