import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { BatchCollector } from "../services/BatchCollector.ts";

describe("BatchCollector", () => {
  it("should deduplicate identical entries", ({ expect }) => {
    const alepha = Alepha.create();
    const collector = alepha.inject(BatchCollector);

    const batch = [
      mockEntry("getUser", { id: "1" }),
      mockEntry("getUser", { id: "1" }),
      mockEntry("getUser", { id: "2" }),
    ];

    // Access the protected dedupe method via a test subclass approach
    const result = (collector as any).dedupe(batch);

    // Two unique entries (id:1 and id:2), three total
    expect(result.unique).toHaveLength(2);
    expect(result.indexMap).toEqual([0, 0, 1]);
  });

  it("should chunk arrays correctly", ({ expect }) => {
    const alepha = Alepha.create();
    const collector = alepha.inject(BatchCollector);

    const items = [1, 2, 3, 4, 5];
    const chunks = (collector as any).chunk(items, 2);

    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("should not deduplicate entries with different params", ({ expect }) => {
    const alepha = Alepha.create();
    const collector = alepha.inject(BatchCollector);

    const batch = [
      mockEntry("getUser", { id: "1" }),
      mockEntry("getUser", { id: "2" }),
      mockEntry("getUser", { id: "3" }),
    ];

    const result = (collector as any).dedupe(batch);

    expect(result.unique).toHaveLength(3);
    expect(result.indexMap).toEqual([0, 1, 2]);
  });

  it("should not deduplicate entries with different actions", ({ expect }) => {
    const alepha = Alepha.create();
    const collector = alepha.inject(BatchCollector);

    const batch = [
      mockEntry("getUser", { id: "1" }),
      mockEntry("getOrder", { id: "1" }),
    ];

    const result = (collector as any).dedupe(batch);

    expect(result.unique).toHaveLength(2);
    expect(result.indexMap).toEqual([0, 1]);
  });
});

function mockEntry(action: string, params?: Record<string, any>) {
  return {
    entry: {
      action,
      params,
      directCall: () => Promise.resolve(),
    },
    resolve: () => {},
    reject: () => {},
  };
}
