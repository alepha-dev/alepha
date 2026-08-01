import { describe, expect, it } from "vitest";
import { bucketIndex, METRICS, VITALS_BUCKETS } from "../sigilVitalsBuckets.ts";

describe("sigilVitalsBuckets", () => {
  it("has ascending boundaries per metric", () => {
    for (const m of METRICS) {
      const b = VITALS_BUCKETS[m];
      for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
    }
  });

  it("maps a value to the first bucket whose upper bound it does not exceed; above last → overflow", () => {
    expect(bucketIndex("lcp", 500)).toBe(0);
    expect(bucketIndex("lcp", 2400)).toBe(2);
    expect(bucketIndex("lcp", 99999)).toBe(VITALS_BUCKETS.lcp.length);
  });
});
