import { AlephaError } from "alepha";

import type {
  AnalyticsDataset,
  AnalyticsTierSpec,
} from "../schemas/analyticsDatasetSchema.ts";
import { AnalyticsBuckets } from "./AnalyticsBuckets.ts";

/**
 * A dataset's retention chain: finest tier first, each folding into the next.
 *
 * The original `{ hot, rollup: "day", cold }` shape is the two-tier chain
 * `[{ resolution, keep: hot }, { resolution: "1d", keep: cold }]`, so every
 * dataset, declared either way, is a list here. A tier is addressed by its
 * index, `0` being the finest.
 *
 * Storage keeps every existing table name: the finest tier is
 * `analytics_<name>_raw`, the coarsest `analytics_<name>_rolled`, and each
 * tier in between `analytics_<name>_<resolution>`. Adding a tier adds a table
 * and renames none.
 */
export class AnalyticsTiers {
  /**
   * The chain, normalised. Never shorter than two tiers.
   */
  public static of(dataset: AnalyticsDataset): AnalyticsTierSpec[] {
    const retention = dataset.retention;
    if (Array.isArray(retention)) return retention;
    return [
      {
        resolution: AnalyticsBuckets.resolutionOf(dataset),
        keep: retention?.hot,
      },
      { resolution: "1d", keep: retention?.cold },
    ];
  }

  /**
   * How long the finest tier keeps a reading, or `undefined` when the
   * dataset never folds.
   */
  public static finestKeep(dataset: AnalyticsDataset): string | undefined {
    return AnalyticsTiers.of(dataset)[0].keep;
  }

  /**
   * The table-name suffix of tier `index`: `raw`, `rolled`, or the tier's
   * resolution in between.
   */
  public static suffix(dataset: AnalyticsDataset, index: number): string {
    const tiers = AnalyticsTiers.of(dataset);
    if (index === 0) return "raw";
    if (index === tiers.length - 1) return "rolled";
    return tiers[index].resolution;
  }

  /**
   * Whether the chain is the original two tiers, finest then days: the only
   * shape a backend without a tier chain (Analytics Engine) can serve.
   */
  public static isTwoTier(dataset: AnalyticsDataset): boolean {
    const tiers = AnalyticsTiers.of(dataset);
    return tiers.length === 2 && tiers[1].resolution === "1d";
  }

  /**
   * Refuses a chain the sweep could not keep: see the rules on
   * `AnalyticsDataset.retention`. The original shape is checked by the same
   * rules once mapped, which is where `cold >= hot` comes from; its `hot`
   * alone may be absent (the dataset then never folds).
   */
  public static assertValid(dataset: AnalyticsDataset): void {
    const declared = dataset.retention;
    const legacy = !Array.isArray(declared);
    const tiers = AnalyticsTiers.of(dataset);
    const fail = (reason: string) => {
      throw new AlephaError(
        `Dataset '${dataset.name}' declares an invalid retention: ${reason}`,
      );
    };

    if (legacy && declared?.rollup !== undefined && declared.rollup !== "day") {
      fail(`rollup '${declared.rollup}' is not supported; only 'day' exists.`);
    }
    if (tiers.length < 2) {
      fail("a chain needs at least two tiers, the finest and the coarsest.");
    }
    if (tiers[0].resolution !== AnalyticsBuckets.resolutionOf(dataset)) {
      fail(
        `the first tier's resolution '${tiers[0].resolution}' must be the dataset's resolution '${AnalyticsBuckets.resolutionOf(dataset)}'.`,
      );
    }

    let previousKeep: { spec: string; millis: number } | undefined;
    for (let index = 0; index < tiers.length; index++) {
      const tier = tiers[index];
      const step = AnalyticsBuckets.minutesOf(tier.resolution) * 60_000;
      const next = tiers[index + 1];

      if (index > 0) {
        const previous = AnalyticsBuckets.minutesOf(
          tiers[index - 1].resolution,
        );
        const current = AnalyticsBuckets.minutesOf(tier.resolution);
        if (current <= previous || current % previous !== 0) {
          fail(
            `'${tier.resolution}' must be strictly coarser than '${tiers[index - 1].resolution}' and a multiple of it.`,
          );
        }
      }

      if (tier.keep === undefined) {
        if (next && !(legacy && index === 0)) {
          fail(
            `only the last tier may omit 'keep'; '${tier.resolution}' does not say how long it keeps its buckets.`,
          );
        }
        continue;
      }

      const millis = AnalyticsBuckets.parseWindow(tier.keep);
      if (millis % step !== 0) {
        fail(
          `'${tier.keep}' is not a whole number of '${tier.resolution}' buckets.`,
        );
      }
      if (next) {
        const nextStep = AnalyticsBuckets.minutesOf(next.resolution) * 60_000;
        if (millis < nextStep) {
          fail(
            `the '${tier.resolution}' tier keeps '${tier.keep}', less than one '${next.resolution}' bucket, so the hourly sweep could never fold a whole one.`,
          );
        }
      }
      if (previousKeep && millis < previousKeep.millis) {
        fail(
          `'${tier.keep}' is shorter than the previous tier's '${previousKeep.spec}'. The sweep only folds a tier past its own window, so a shorter one later in the chain would delete readings before they are ever folded.`,
        );
      }
      previousKeep = { spec: tier.keep, millis };
    }
  }
}
