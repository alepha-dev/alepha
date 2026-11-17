import { AlephaError } from "alepha";

import type { ProjectResource } from "../../../api/schemas/projectResourceSchema.ts";

/**
 * What each module reads when a project opens, and clears when it closes
 * (#E75, #Q2624): Work's releases, epics, areas, counts and the viewer's open
 * quests, Deploy's deployed copies and open errors.
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
   * Fetch every contribution together, and answer the one write that applies
   * them all, in order.
   *
   * Fetching writes nothing, on purpose (#Q3824): the loader starts it from
   * the project row the rail holds, before the slug has answered, and only
   * the answer decides whether what came back is written or thrown away.
   */
  public async fetch(project: ProjectLoaderSubject): Promise<() => void> {
    const apply = await Promise.all(
      this.contributions.map((it) => it.load(project)),
    );
    return () => {
      for (const write of apply) write();
    };
  }

  /**
   * Whether two rows of a project lead every contribution to the same reads:
   * the same project, with the same capabilities and options.
   */
  public same(a: ProjectLoaderSubject, b: ProjectLoaderSubject): boolean {
    return this.signature(a) === this.signature(b);
  }

  /**
   * Clear what every contribution wrote, on leaving the project.
   */
  public leave(): void {
    for (const it of this.contributions) it.leave();
  }

  /**
   * A subject as text, whatever order its capabilities and their options
   * arrived in.
   */
  protected signature(project: ProjectLoaderSubject): string {
    const capabilities = project.capabilities
      .map(
        (it) =>
          [
            it.key,
            Object.entries(it.options).sort(([a], [b]) => (a < b ? -1 : 1)),
          ] as const,
      )
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return JSON.stringify([project.id, capabilities]);
  }
}

/**
 * What a contribution may read of the project it loads for: its id and its
 * capabilities, and nothing else.
 *
 * Narrow on purpose (#Q3824). The loader may start the reads from the row the
 * rail holds, which carries no rank and no permissions, and keeps them when
 * that row and the answer agree on exactly these two
 * ({@link ProjectLoaderRegistry.same}). A contribution that needs more of the
 * project widens this type and that comparison together.
 */
export type ProjectLoaderSubject = Pick<ProjectResource, "id" | "capabilities">;

/**
 * One module's part of opening a project.
 */
export interface ProjectLoaderContribution {
  key: string;
  order: number;
  /**
   * Fetch, and answer the writes to make once every contribution has
   * fetched. A failure that must not cost the whole project is caught here.
   *
   * ⚠️ It writes nothing itself: what it fetched may be thrown away.
   */
  load: (project: ProjectLoaderSubject) => Promise<() => void>;
  leave: () => void;
}
