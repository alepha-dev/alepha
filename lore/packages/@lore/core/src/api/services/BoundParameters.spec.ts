import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { BoundParameters } from "./BoundParameters.ts";

describe("BoundParameters", () => {
  const make = () => Alepha.create().inject(BoundParameters);

  it("keeps the batch under Cloudflare D1's 100-parameter ceiling", ({
    expect,
  }) => {
    // The number itself is the point of this file: raise it past 100 and
    // every chunked read in Lore starts failing in production only, on the
    // day a list crosses the ceiling.
    expect(make().limit).toBeLessThan(100);
  });

  it("splits a list into batches of at most `limit`", ({ expect }) => {
    const bound = make();
    const ids = Array.from({ length: 101 }, (_, i) => i);

    const batches = bound.chunk(ids);

    expect(batches.length).toBe(2);
    expect(batches.every((b) => b.length <= bound.limit)).toBe(true);
    expect(batches.flat()).toEqual(ids);
  });

  it("gives no batch at all for an empty list, because `inArray: []` throws", ({
    expect,
  }) => {
    expect(make().chunk([])).toEqual([]);
  });

  it("gives a single batch when the list fits", ({ expect }) => {
    const bound = make();
    expect(bound.chunk(["a", "b", "c"])).toEqual([["a", "b", "c"]]);
  });

  describe("collect", () => {
    it("concatenates the rows of every batch, in order", async ({ expect }) => {
      const bound = make();
      const ids = Array.from({ length: 250 }, (_, i) => i);

      const rows = await bound.collect(ids, async (batch) =>
        batch.map((id) => `row-${id}`),
      );

      expect(rows.length).toBe(250);
      expect(rows[0]).toBe("row-0");
      expect(rows[249]).toBe("row-249");
    });

    it("never hands the reader a batch over the limit", async ({ expect }) => {
      const bound = make();
      const sizes: number[] = [];

      await bound.collect(
        Array.from({ length: 200 }, (_, i) => i),
        async (batch) => {
          sizes.push(batch.length);
          return [];
        },
      );

      expect(sizes).toEqual([90, 90, 20]);
    });

    it("never reads at all for an empty list", async ({ expect }) => {
      let reads = 0;

      const rows = await make().collect([], async () => {
        reads++;
        return [];
      });

      expect(reads).toBe(0);
      expect(rows).toEqual([]);
    });
  });
});
