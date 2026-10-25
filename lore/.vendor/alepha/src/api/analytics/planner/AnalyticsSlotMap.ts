import { AlephaError } from "alepha";

import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";

/**
 * Where each dimension and measure lives in an Analytics Engine data point.
 *
 * **This is a wire format.** Analytics Engine addresses fields positionally
 * (`blob1…blob20`, `double1…double20`) regardless of the alias used in a
 * `SELECT`, so once rows are stored, changing this mapping silently misreads
 * history rather than failing.
 *
 * Slots therefore come from the dataset's own `slots` declaration, an
 * ordered, append-only list of names, and never from the shape of
 * `dimensions` / `measures`. That declaration is the only thing that decides a
 * position, which gives the three properties this format needs:
 *
 * - **Reordering the `z.object` literal is a no-op.** Nothing reads its key
 *   order.
 * - **Renaming is correctly breaking**, loudly: the new name is not in the
 *   pinned list, so the dataset refuses to boot instead of reading history
 *   under a different meaning.
 * - **Adding is append-only.** A new name goes on the end and takes the next
 *   free slot; every existing slot is where it was.
 *
 * A name may also be **retired**: delete it from `dimensions`, leave it in
 * `slots.dimensions`. The slot stays reserved and unused, so removing a
 * dimension does not shift the ones declared after it either.
 *
 * ⚠️ This replaced a derivation from **alphabetically sorted** names, which
 * had the first two properties and not the third: a new dimension landed
 * wherever it sorted and pushed every later one along by a slot. Adding
 * `referrer` to Lore's `sigil_views` in 2026-08 moved `sigilId` and made eight
 * days of stored views match no filter at all: they are still in the dataset,
 * unreadable, and Analytics Engine has no update or delete API to repair them
 * with. That is the failure this class exists to make impossible.
 *
 * `blob1` carries the dataset name because Analytics Engine has no table
 * concept, so several datasets share one binding and a discriminator is
 * mandatory. `blob2` carries the hour bucket for every dataset, so a query
 * filtering the window never has to know which dataset it is reading.
 */
export class AnalyticsSlotMap {
  /**
   * `blob1`: the dataset name discriminator.
   */
  public static readonly KIND_SLOT = 1;

  /**
   * `blob2`: the UTC hour bucket, on every dataset.
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
    const dimensions = Object.keys(dataset.dimensions.shape);
    const measures = Object.keys(dataset.measures.shape);

    AnalyticsSlotMap.assertPinList(
      dataset,
      "dimensions",
      dataset.slots.dimensions,
      AnalyticsSlotMap.MAX_DIMENSIONS,
    );
    AnalyticsSlotMap.assertPinList(
      dataset,
      "measures",
      dataset.slots.measures,
      AnalyticsSlotMap.MAX_MEASURES,
    );
    AnalyticsSlotMap.assertPinned(
      dataset,
      "dimensions",
      dimensions,
      dataset.slots.dimensions,
    );
    AnalyticsSlotMap.assertPinned(
      dataset,
      "measures",
      measures,
      dataset.slots.measures,
    );

    if (!dimensions.includes(dataset.index)) {
      throw new AlephaError(
        `Dataset '${dataset.name}': '${dataset.index}' is not a declared dimension.`,
      );
    }

    // Only DECLARED names get an entry. A retired pin still consumes its
    // position (that is the whole point of leaving it in the list) but it
    // has no value to write and no column to read, so it must not surface in
    // `dimensionNames` / `measureNames`, which are what the writer iterates.
    const blobs = new Map<string, number>();
    dataset.slots.dimensions.forEach((name, offset) => {
      if (dimensions.includes(name)) {
        blobs.set(name, AnalyticsSlotMap.HOUR_SLOT + 1 + offset);
      }
    });

    const doubles = new Map<string, number>();
    dataset.slots.measures.forEach((name, offset) => {
      if (measures.includes(name)) {
        doubles.set(name, offset + 1);
      }
    });

    return new AnalyticsSlotMap(blobs, doubles);
  }

  /**
   * Refuses a pin list that cannot be a wire format: a duplicate name would
   * give one field two positions, and a list past the slot ceiling names a
   * position Analytics Engine does not have.
   */
  protected static assertPinList(
    dataset: AnalyticsDataset,
    kind: "dimensions" | "measures",
    pins: string[],
    max: number,
  ): void {
    const seen = new Set<string>();
    for (const name of pins) {
      if (seen.has(name)) {
        throw new AlephaError(
          `Dataset '${dataset.name}' pins '${name}' twice in slots.${kind}. A name has exactly one slot; the list is the wire format, so it must not repeat.`,
        );
      }
      seen.add(name);
    }

    if (pins.length > max) {
      throw new AlephaError(
        `Dataset '${dataset.name}' pins ${pins.length} ${kind} slots; Analytics Engine allows at most ${max}${
          kind === "dimensions" ? " (20 blobs minus 2 reserved)" : ""
        }. Retired names count: they keep their slot reserved on purpose.`,
      );
    }
  }

  /**
   * Refuses a declared name that no slot claims.
   *
   * This is the check that catches a rename, and it is deliberately loud: the
   * alternative is reading every stored row's old value under the new name.
   * The message says APPEND rather than "add", because inserting the name
   * anywhere else is exactly the mistake the pin list exists to prevent.
   */
  protected static assertPinned(
    dataset: AnalyticsDataset,
    kind: "dimensions" | "measures",
    declared: string[],
    pins: string[],
  ): void {
    const missing = declared.filter((name) => !pins.includes(name));
    if (missing.length === 0) {
      return;
    }

    throw new AlephaError(
      `Dataset '${dataset.name}' declares ${missing.map((n) => `'${n}'`).join(", ")} ` +
        `with no slot. Slots are a wire format: APPEND the name to the END of ` +
        `slots.${kind}: [${[...pins, ...missing].map((n) => `"${n}"`).join(", ")}] ` +
        "and never insert or reorder, which would move every stored row's " +
        "value into a neighbouring field. If this is a RENAME, appending reads " +
        "the old rows as empty rather than as the new dimension; keep the old " +
        "name in the list to leave its slot reserved.",
    );
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
