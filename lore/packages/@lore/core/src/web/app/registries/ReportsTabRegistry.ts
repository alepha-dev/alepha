import { AlephaError } from "alepha";

import type { CapabilityKey } from "../../../api/schemas/capabilityKeySchema.ts";
import type { ProjectResource } from "../../../api/schemas/projectResourceSchema.ts";
import { hasCapability } from "../services/projectCapabilities.ts";

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

  public register(tab: ReportsTab): void {
    if (this.entries.some((it) => it.route === tab.route)) {
      throw new AlephaError(`Reports tab '${tab.route}' is registered twice`);
    }
    this.entries.push(tab);
    this.entries.sort((a, b) => a.order - b.order);
  }

  /**
   * Which tabs a project has wants to know something only a request can
   * answer (whether a quality run exists): each such tab's `available` runs
   * here, in parallel, when Reports opens. A failure hides the tab, never the
   * page.
   */
  public async availability(projectId: number): Promise<string[]> {
    const answers = await Promise.all(
      this.entries.map(async (tab) =>
        !tab.available || (await tab.available(projectId).catch(() => false))
          ? tab.route
          : undefined,
      ),
    );
    return answers.filter((it): it is string => !!it);
  }

  /**
   * Which Reports tabs this project has, given what `availability` answered.
   */
  public tabs(
    project: Pick<ProjectResource, "capabilities"> | undefined,
    available: readonly string[],
  ): ReportsTab[] {
    return this.entries.filter(
      (tab) =>
        (!tab.needs || hasCapability(project, tab.needs)) &&
        available.includes(tab.route),
    );
  }
}

export interface ReportsTab {
  /**
   * The tab's `$page` name, mounted under `projectReports`.
   */
  route: string;
  labelKey: string;
  order: number;
  /**
   * The capability this tab's data source belongs to.
   */
  needs?: CapabilityKey;
  /**
   * A last say that needs a request, run when Reports opens. Only Quality
   * has one: the tab exists once there is something in it.
   */
  available?: (projectId: number) => Promise<boolean>;
}
