import { AlephaError } from "alepha";

import type { ProjectResource } from "../../../api/schemas/projectResourceSchema.ts";

/**
 * What each module reads when a project opens, and clears when it closes
 * (#E75, #Q2624): Work's releases, epics, areas, counts and the viewer's open
 * quests, Deploy's deployed copies and open blights.
 *
 * The `project` page's loader (`ProjectRouter`) is core and reads no module's
 * client. It resolves the project, then runs every registered contribution in
 * ONE `Promise.all`, so the browser's `BatchCollector` still coalesces them
 * into a single `POST /api/_batch`, as when the loader named nine clients.
 * Each contribution fetches, then hands back what to write: the writes run
 * once every fetch has settled, in `order`, so the page never sees half a
 * project.
 */
export class ProjectLoaderRegistry {
  protected readonly contributions: ProjectLoaderContribution[] = [];

  public register(contribution: ProjectLoaderContribution): void {
    if (this.contributions.some((it) => it.key === contribution.key)) {
      throw new AlephaError(
        `Project loader contribution '${contribution.key}' is registered twice`,
      );
    }
    this.contributions.push(contribution);
    this.contributions.sort((a, b) => a.order - b.order);
  }

  /**
   * Fetch every contribution together, then apply them in order.
   */
  public async load(project: ProjectResource): Promise<void> {
    const apply = await Promise.all(
      this.contributions.map((it) => it.load(project)),
    );
    for (const write of apply) write();
  }

  /**
   * Clear what every contribution wrote, on leaving the project.
   */
  public leave(): void {
    for (const it of this.contributions) it.leave();
  }
}

/**
 * One module's part of opening a project.
 */
export interface ProjectLoaderContribution {
  key: string;
  order: number;
  /**
   * Fetch, and answer the writes to make once every contribution has
   * fetched. A failure that must not cost the whole project is caught here.
   */
  load: (project: ProjectResource) => Promise<() => void>;
  leave: () => void;
}
