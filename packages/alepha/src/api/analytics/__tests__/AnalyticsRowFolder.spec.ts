import { z } from "alepha";
import { describe, expect, it } from "vitest";

import { AnalyticsRowFolder } from "../planner/AnalyticsRowFolder.ts";

const dataset = {
  name: "folder_views",
  index: "deviceId",
  dimensions: z.object({ deviceId: z.string(), line: z.string() }),
  measures: z.object({ validations: z.number(), errors: z.number() }),
  slots: {
    dimensions: ["deviceId", "line"],
    measures: ["validations", "errors"],
  },
};

describe("AnalyticsRowFolder", () => {
  it("sums rows sharing a bucket and every dimension", () => {
    const folded = AnalyticsRowFolder.fold(dataset, [
      {
        hour: "2026-08-09T10",
        deviceId: "d1",
        line: "l1",
        validations: 2,
        errors: 1,
      },
      {
        hour: "2026-08-09T10",
        deviceId: "d1",
        line: "l1",
        validations: 3,
        errors: 0,
      },
    ]);

    expect(folded).toEqual([
      {
        hour: "2026-08-09T10",
        deviceId: "d1",
        line: "l1",
        validations: 5,
        errors: 1,
      },
    ]);
  });

  it("keeps rows apart when the bucket or any dimension differs", () => {
    const folded = AnalyticsRowFolder.fold(dataset, [
      { hour: "2026-08-09T10", deviceId: "d1", line: "l1", validations: 1 },
      { hour: "2026-08-09T11", deviceId: "d1", line: "l1", validations: 1 },
      { hour: "2026-08-09T10", deviceId: "d1", line: "l2", validations: 1 },
    ]);

    expect(folded).toHaveLength(3);
  });

  it("treats a missing measure as zero and does not mutate its input", () => {
    const first = {
      hour: "2026-08-09T10",
      deviceId: "d1",
      line: "l1",
      validations: 1,
    };
    const folded = AnalyticsRowFolder.fold(dataset, [
      first,
      { hour: "2026-08-09T10", deviceId: "d1", line: "l1", errors: 4 },
    ]);

    expect(folded[0]).toMatchObject({ validations: 1, errors: 4 });
    expect(first).not.toHaveProperty("errors");
  });

  it("does not merge values that only collide under a delimiter join", () => {
    const folded = AnalyticsRowFolder.fold(dataset, [
      { hour: "2026-08-09T10", deviceId: "a|b", line: "c", validations: 1 },
      { hour: "2026-08-09T10", deviceId: "a", line: "b|c", validations: 1 },
    ]);

    expect(folded).toHaveLength(2);
  });
});
