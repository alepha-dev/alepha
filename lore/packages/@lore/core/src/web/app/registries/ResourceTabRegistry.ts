import { AlephaError } from "alepha";
import type { ComponentType } from "react";

/**
 * Tabs a module adds to another module's resource page (#E75, #Q2624): Deploy
 * adds Artifacts to a release, since a release lists the artifacts built
 * from its tag, and Knowledge adds Folios to an epic, since an epic files
 * folios.
 *
 * The page names no module. It renders its own tabs, then every tab
 * registered for its resource, and reads each one's count for its plate, its
 * KPIs and its warnings through the labels the tab declared.
 *
 * ## ⚠️ The tabs are frozen once read
 *
 * `useCollection` is a HOOK the page calls once per registered tab, in a
 * loop, which is only legal while the loop is the same length on every
 * render. The set closes the first time it is read: every shell registers
 * from its constructor, at boot, and a late registration throws.
 */
export class ResourceTabRegistry {
  protected readonly entries: ResourceTab[] = [];
  protected frozen = false;

  public register(tab: ResourceTab): void {
    if (this.frozen) {
      throw new AlephaError(
        `Resource tab '${tab.resource}:${tab.key}' registered after the tabs were first read`,
      );
    }
    if (
      this.entries.some(
        (it) => it.resource === tab.resource && it.key === tab.key,
      )
    ) {
      throw new AlephaError(
        `Resource tab '${tab.resource}:${tab.key}' is registered twice`,
      );
    }
    this.entries.push(tab);
    this.entries.sort((a, b) => a.order - b.order);
  }

  /**
   * The tabs registered for one resource, in `order`.
   */
  public tabs(resource: string): ResourceTab[] {
    this.frozen = true;
    return this.entries.filter((it) => it.resource === resource);
  }
}

/**
 * What the page hands a registered tab: the resource it shows.
 */
export interface ResourceTabSubject {
  projectId: number;
  id: number;
  number: number;
  /**
   * A release's tag, the join its artifacts are matched on. Absent for a
   * release with none.
   */
  tag?: string;
  /**
   * Whether the reader may change what is filed under it: the host page's
   * answer, since the gate is the resource's own (`epic:write`).
   */
  writable?: boolean;
}

/**
 * One registered tab, with the labels the page shows its count under.
 */
export interface ResourceTab {
  /**
   * The resource kind whose page draws it (`release`).
   */
  resource: string;
  key: string;
  order: number;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * A HOOK: the collection's size for the subject. `count` is `undefined`
   * until it has resolved, so the page renders the bare label rather than a
   * confident "0".
   */
  useCollection: (subject: ResourceTabSubject) => {
    count?: number;
    loading: boolean;
  };
  /**
   * The tab's body. It reads the same collection, from the same query key,
   * so opening the tab sends nothing new.
   */
  component: ComponentType<{ subject: ResourceTabSubject }>;
  /**
   * The plate's "3 artifacts" stat, singular and plural, with the count as
   * the first argument.
   */
  metaKeys?: { one: string; many: string };
  /**
   * The overview KPI: its label, and its note when the collection has rows
   * and when it is empty, each with the release's tag (or number) as the
   * first argument.
   */
  kpiKeys?: { label: string; some: string; none: string };
  /**
   * What the edit form warns about when the tag the collection is matched
   * on is changed: singular with the saved tag as the argument, plural with
   * the count then the saved tag. Absent when retagging leaves it alone.
   */
  retagKeys?: { one: string; many: string };
}

/**
 * One registered tab with its collection read for the page's subject.
 */
export interface LinkedCollection {
  tab: ResourceTab;
  count?: number;
  loading: boolean;
}
