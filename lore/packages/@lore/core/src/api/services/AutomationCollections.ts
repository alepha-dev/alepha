import { AlephaError } from "alepha";

import type { AutomationCollection } from "../schemas/automationCollectionSchema.ts";
import type { AutomationRunSnapshot } from "../schemas/automationRunSnapshotSchema.ts";

/**
 * Only named, deterministic server formatters can summarize collections.
 */
export class AutomationCollections {
  protected readonly formatters = new Map<
    string,
    (input: AutomationCollectionFormatInput) => string
  >();
  public register(
    key: string,
    formatter: (input: AutomationCollectionFormatInput) => string,
  ): void {
    if (this.formatters.has(key))
      throw new AlephaError(
        `Duplicate automation collection formatter '${key}'`,
      );
    this.formatters.set(key, formatter);
  }
  public format(
    key: string,
    collection: AutomationCollection,
    values: AutomationRunSnapshot["inputs"],
    shown: number,
  ): string {
    const formatter = this.formatters.get(key);
    if (!formatter)
      throw new AlephaError(`No registered collection formatter for '${key}'`);
    return formatter({
      ...collection,
      selected: collection.items.length,
      shown,
      items: collection.items,
      values,
    });
  }
}

export interface AutomationCollectionFormatInput extends AutomationCollection {
  selected: number;
  shown: number;
  values: AutomationRunSnapshot["inputs"];
}
