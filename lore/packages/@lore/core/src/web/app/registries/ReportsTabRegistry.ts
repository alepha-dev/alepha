import { AlephaError } from "alepha";
import type { LucideIcon } from "lucide-react";

import type { CapabilityKey } from "../../../api/schemas/capabilityKeySchema.ts";
import type { ProjectResource } from "../../../api/schemas/projectResourceSchema.ts";
import { hasCapability } from "../services/projectCapabilities.ts";
import type { ReportsFilterKey } from "../services/ReportsUrlQuery.ts";

/**
 * The tabs of the Reports page, as each module registers them (#E75,
 * #Q2611): Work's Overview, Quests and Members, Deploy's Quality.
 *
 * Reports itself is CORE and its entry is unconditional, which is the whole
 * reason each tab declares its own gate: Quality is Apps baseline, so an
 * Apps-only project would lose its Quality tab along with the Reports entry
 * if the section belonged to Work. The pages are each module's, mounted
 * under core's `projectReports` with `parent:`.
 */
export class ReportsTabRegistry {
  protected readonly entries: ReportsTab[] = [];
  protected readonly filterEntries: ReportsFilter[] = [];

  /**
   * A filter of the bar that core cannot draw: its options are a module's.
   */
  public registerFilter(filter: ReportsFilter): void {
    if (this.filterEntries.some((it) => it.key === filter.key)) {
      throw new AlephaError(
        `Reports filter '${filter.key}' is registered twice`,
      );
    }
    this.filterEntries.push(filter);
  }

  public filters(): ReportsFilter[] {
    return this.filterEntries;
  }

  /**
   * The filters `route` declares. A tab with none honours none, and the report
   * behind it is read with the empty query.
   */
  public honours(route: string): readonly ReportsFilterKey[] {
    return this.entries.find((it) => it.route === route)?.filters ?? [];
  }

  public register(tab: ReportsTab): void {
    if (this.entries.some((it) => it.route === tab.route)) {
      throw new AlephaError(`Reports tab '${tab.route}' is registered twice`);
    }
    this.entries.push(tab);
    this.entries.sort((a, b) => a.order - b.order);
  }

  /**
   * Which Reports tabs this project has.
   */
  public tabs(
    project: Pick<ProjectResource, "capabilities"> | undefined,
  ): ReportsTab[] {
    return this.entries.filter(
      (tab) => !tab.needs || hasCapability(project, tab.needs),
    );
  }
}

export interface ReportsTab {
  /**
   * The tab's `$page` name, mounted under `projectReports`.
   */
  route: string;
  labelKey: string;
  /**
   * What the tab answers, in a line under the bar.
   */
  descriptionKey?: string;
  icon?: LucideIcon;
  order: number;
  /**
   * The capability this tab's data source belongs to.
   */
  needs?: CapabilityKey;
  /**
   * The filters this tab honours: its loader reads only these, and the bar
   * shows the others disabled (#Q2996).
   */
  filters?: readonly ReportsFilterKey[];
}

export interface ReportsFilter {
  key: Exclude<ReportsFilterKey, "period" | "grain" | "compare" | "branch">;
  labelKey: string;
  needs?: CapabilityKey;
  /**
   * The filter's values. A hook, called once by the component drawing this
   * filter.
   */
  useOptions: () => Array<{ value: string; label: string }>;
}
