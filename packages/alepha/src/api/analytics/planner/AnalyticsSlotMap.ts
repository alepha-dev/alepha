import { AlephaError } from "alepha";

import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";

/**
 * Where each dimension and measure lives in an Analytics Engine data point.
 *
 * **This is a wire format.** Analytics Engine addresses fields positionally
 * (`blob1…blob20`, `double1…double20`) regardless of the alias used in a
 * `SELECT`, so once rows are stored, changing this derivation silently
 * misreads history rather than failing.
 *
 * Slots derive from **alphabetically sorted** names, never declaration order:
 * reordering the object literal is then a no-op, while renaming a dimension is
 * correctly a breaking schema change.
 *
 * `blob1` carries the dataset name because Analytics Engine has no table
 * concept — several datasets share one binding, so a discriminator is
 * mandatory. `blob2` carries the hour bucket for every dataset, so a query
 * filtering the window never has to know which dataset it is reading.
 */
export class AnalyticsSlotMap {
  /**
   * `blob1` — the dataset name discriminator.
   */
  public static readonly KIND_SLOT = 1;

  /**
   * `blob2` — the UTC hour bucket, on every dataset.
   */
  public static readonly HOUR_SLOT = 2;

  /**
   * 20 blobs minus the two reserved above.
   */
  public static readonly MAX_DIMENSIONS = 18;

  public static readonly MAX_MEASURES = 20;

  protected readonly blobs: Map<string, number>;
  protected readonly doubles: Map<string, number>;

  protected constructor(
    blobs: Map<string, number>,
    doubles: Map<string, number>,
  ) {
    this.blobs = blobs;
    this.doubles = doubles;
  }

  public static forDataset(dataset: AnalyticsDataset): AnalyticsSlotMap {
    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    const measures = Object.keys(dataset.measures.shape).sort();

    if (dimensions.length > AnalyticsSlotMap.MAX_DIMENSIONS) {
      throw new AlephaError(
        `Dataset '${dataset.name}' declares ${dimensions.length} dimensions; Analytics Engine allows at most 18 dimensions (20 blobs minus 2 reserved).`,
      );
    }
    if (measures.length > AnalyticsSlotMap.MAX_MEASURES) {
      throw new AlephaError(
        `Dataset '${dataset.name}' declares ${measures.length} measures; Analytics Engine allows at most 20.`,
      );
    }
    if (!dimensions.includes(dataset.index)) {
      throw new AlephaError(
        `Dataset '${dataset.name}': '${dataset.index}' is not a declared dimension.`,
      );
    }

    const blobs = new Map<string, number>();
    dimensions.forEach((name, offset) => {
      blobs.set(name, AnalyticsSlotMap.HOUR_SLOT + 1 + offset);
    });

    const doubles = new Map<string, number>();
    measures.forEach((name, offset) => {
      doubles.set(name, offset + 1);
    });

    return new AnalyticsSlotMap(blobs, doubles);
  }

  public blobSlot(dimension: string): number {
    const slot = this.blobs.get(dimension);
    if (slot === undefined) {
      throw new AlephaError(`Dataset has unknown dimension '${dimension}'.`);
    }
    return slot;
  }

  public doubleSlot(measure: string): number {
    const slot = this.doubles.get(measure);
    if (slot === undefined) {
      throw new AlephaError(`Dataset has unknown measure '${measure}'.`);
    }
    return slot;
  }

  public get dimensionNames(): string[] {
    return [...this.blobs.keys()];
  }

  public get measureNames(): string[] {
    return [...this.doubles.keys()];
  }
}
