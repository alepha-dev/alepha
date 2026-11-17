import { AlephaError } from "alepha";
import type { ComponentType, ReactNode } from "react";

/**
 * Rows a module adds to another module's resource rail (#E154): Ship adds
 * where a quest is live to the quest page's rail, since a deployed copy is
 * Ship's and a quest Plan's, and neither may import the other.
 *
 * The page names no module: it renders its own rows, then one per registered
 * entry for its resource, each wrapped in its own row component. An entry
 * whose value is `undefined` draws nothing, the rail's rule for a row with no
 * data.
 *
 * Frozen once read, like `ResourceTabRegistry`: every shell registers from
 * its constructor, at boot, and a late registration throws.
 */
export class ResourceRailRegistry {
  protected readonly entries: ResourceRailEntry[] = [];
  protected frozen = false;

  public register(entry: ResourceRailEntry): void {
    if (this.frozen) {
      throw new AlephaError(
        `Resource rail row '${entry.resource}:${entry.key}' registered after the rail was first read`,
      );
    }
    if (
      this.entries.some(
        (it) => it.resource === entry.resource && it.key === entry.key,
      )
    ) {
      throw new AlephaError(
        `Resource rail row '${entry.resource}:${entry.key}' is registered twice`,
      );
    }
    this.entries.push(entry);
    this.entries.sort((a, b) => a.order - b.order);
  }

  /**
   * The rows registered for one resource, in `order`.
   */
  public rows(resource: string): ResourceRailEntry[] {
    this.frozen = true;
    return this.entries.filter((it) => it.resource === resource);
  }
}

/**
 * What the page hands a registered row: the resource it shows.
 */
export interface ResourceRailSubject {
  projectId: number;
  /**
   * The resource's per-project number: a quest's `shortId`.
   */
  number: number;
}

export interface ResourceRailEntry {
  /**
   * The resource kind whose rail draws it (`quest`).
   */
  resource: string;
  key: string;
  order: number;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * A HOOK: the row's value for the subject, or `undefined` for no row. The
   * page calls it from one component per row, so it may hold its own query.
   */
  useValue: (subject: ResourceRailSubject) => ReactNode | undefined;
}
