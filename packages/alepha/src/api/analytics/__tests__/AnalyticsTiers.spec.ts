import { z } from "alepha";
import { describe, expect, it } from "vitest";

import { AnalyticsTiers } from "../planner/AnalyticsTiers.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import { AnalyticsEntityFactory } from "../services/AnalyticsEntityFactory.ts";

const base: AnalyticsDataset = {
  name: "device_metrics",
  index: "deviceId",
  resolution: "1m",
  dimensions: z.object({ deviceId: z.string() }),
  measures: z.object({ validations: z.number() }),
  slots: { dimensions: ["deviceId"], measures: ["validations"] },
};

const chain = (retention: AnalyticsDataset["retention"]) => () =>
  AnalyticsTiers.assertValid({ ...base, retention });

describe("AnalyticsTiers", () => {
  it("maps the original shape onto a two-tier chain", () => {
    expect(
      AnalyticsTiers.of({
        ...base,
        resolution: undefined,
        retention: { hot: "60d", rollup: "day", cold: "400d" },
      }),
    ).toEqual([
      { resolution: "1h", keep: "60d" },
      { resolution: "1d", keep: "400d" },
    ]);
    expect(AnalyticsTiers.of({ ...base, retention: undefined })).toEqual([
      { resolution: "1m", keep: undefined },
      { resolution: "1d", keep: undefined },
    ]);
  });

  it("accepts a minute, hour, day chain with growing windows", () => {
    expect(
      chain([
        { resolution: "1m", keep: "48h" },
        { resolution: "1h", keep: "30d" },
        { resolution: "1d", keep: "400d" },
      ]),
    ).not.toThrow();
    expect(
      chain([
        { resolution: "1m", keep: "48h" },
        { resolution: "1h", keep: "30d" },
        { resolution: "1d" },
      ]),
    ).not.toThrow();
  });

  it("refuses a first tier that is not the dataset's resolution", () => {
    expect(
      chain([
        { resolution: "5m", keep: "48h" },
        { resolution: "1d", keep: "30d" },
      ]),
    ).toThrow("must be the dataset's resolution");
  });

  it("refuses a tier that is not strictly coarser than the previous one", () => {
    expect(
      chain([
        { resolution: "1m", keep: "48h" },
        { resolution: "1m", keep: "30d" },
      ]),
    ).toThrow("strictly coarser");
  });

  it("refuses a keep that is not a whole number of its tier's buckets", () => {
    expect(
      chain([
        { resolution: "1m", keep: "48h" },
        { resolution: "1h", keep: "90m" },
        { resolution: "1d" },
      ]),
    ).toThrow("not a whole number of '1h' buckets");
  });

  it("refuses a keep shorter than the previous tier's", () => {
    expect(
      chain([
        { resolution: "1m", keep: "48h" },
        { resolution: "1h", keep: "24h" },
        { resolution: "1d" },
      ]),
    ).toThrow("shorter than the previous tier");
  });

  it("refuses a keep shorter than one bucket of the next tier", () => {
    expect(
      chain([
        { resolution: "1m", keep: "30m" },
        { resolution: "1h", keep: "30d" },
        { resolution: "1d" },
      ]),
    ).toThrow("less than one '1h' bucket");
  });

  it("refuses a missing keep anywhere but the last tier", () => {
    expect(
      chain([
        { resolution: "1m" },
        { resolution: "1h", keep: "30d" },
        { resolution: "1d" },
      ]),
    ).toThrow("only the last tier may omit 'keep'");
  });

  it("refuses a chain of a single tier", () => {
    expect(chain([{ resolution: "1m", keep: "48h" }])).toThrow(
      "at least two tiers",
    );
  });

  it("names the finest table _raw, the coarsest _rolled, and the rest by resolution", () => {
    const { tables } = AnalyticsEntityFactory.build({
      ...base,
      retention: [
        { resolution: "1m", keep: "48h" },
        { resolution: "15m", keep: "7d" },
        { resolution: "1h", keep: "30d" },
        { resolution: "1d" },
      ],
    });

    expect(tables.map((table) => table.name)).toEqual([
      "analytics_device_metrics_raw",
      "analytics_device_metrics_15m",
      "analytics_device_metrics_1h",
      "analytics_device_metrics_rolled",
    ]);
  });
});
