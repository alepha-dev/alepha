import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { projectDashboardCards } from "../entities/projectDashboardCards.ts";
import {
  type ProjectDashboard,
  projectDashboards,
} from "../entities/projectDashboards.ts";

/**
 * Which dashboard a call is about (#E127, #Q3298).
 *
 * `row` is undefined only for a project's implicit first dashboard, the one a
 * project with no `project_dashboards` row has. `first` says whether the
 * dashboard is its project's first, which is the one a card with no
 * `dashboardId` belongs to.
 */
export interface DashboardTarget {
  projectId: number;
  row?: ProjectDashboard;
  first: boolean;
}

/**
 * A project's dashboards: which one a call names, and the lazy creation of the
 * first.
 *
 * See `projectDashboards` for the two rules this service enforces: rows are
 * lazy, and "first" is the lowest position, ties on id.
 */
export class ProjectDashboardService {
  protected readonly dashboards = $repository(projectDashboards);
  protected readonly cards = $repository(projectDashboardCards);

  /**
   * This project's dashboards in creation order, which is their order.
   * Empty for a project whose only dashboard is still implicit.
   */
  async list(projectId: number): Promise<ProjectDashboard[]> {
    return this.dashboards.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [
        { column: "position", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    });
  }

  /**
   * The first dashboard's row, or undefined while it is implicit.
   */
  async first(projectId: number): Promise<ProjectDashboard | undefined> {
    const [row] = await this.dashboards.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [
        { column: "position", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
      limit: 1,
    });
    return row;
  }

  /**
   * The dashboard a read names: the one with this id, or the first when none
   * is named. A dashboard of another project is a 404, never a read across
   * projects.
   */
  async target(
    projectId: number,
    dashboardId?: number,
  ): Promise<DashboardTarget> {
    const first = await this.first(projectId);
    if (dashboardId === undefined || dashboardId === first?.id) {
      return { projectId, row: first, first: true };
    }
    const row = await this.dashboards.findOne({
      where: { id: { eq: dashboardId }, projectId: { eq: projectId } },
    });
    if (!row) {
      throw new NotFoundError("Dashboard not found");
    }
    return { projectId, row, first: false };
  }

  /**
   * The dashboard a write names, with a row: the first is created when it is
   * still implicit, and adopts the project's cards that have no dashboard.
   *
   * The adoption runs every time the first is resolved for a write, not only
   * when it is created: the previous Worker can write a null card in the
   * deploy window, and one left null would drift to whichever dashboard is
   * first once this one is deleted.
   */
  async targetForWrite(
    projectId: number,
    dashboardId?: number,
  ): Promise<DashboardTarget & { row: ProjectDashboard }> {
    const target = await this.target(projectId, dashboardId);
    if (!target.first) {
      return target as DashboardTarget & { row: ProjectDashboard };
    }
    const row = target.row ?? (await this.createFirst(projectId));
    await this.cards.updateMany(
      { projectId: { eq: projectId }, dashboardId: { isNull: true } },
      { dashboardId: row.id },
    );
    return { projectId, row, first: true };
  }

  /**
   * The row of a project's first dashboard, which nobody named: no name and
   * no slug, so the screen shows the localized label.
   */
  protected async createFirst(projectId: number): Promise<ProjectDashboard> {
    return this.dashboards.create({ projectId, position: 0 });
  }
}
