import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import { projectDashboardCards } from "../entities/projectDashboardCards.ts";
import {
  type ProjectDashboard,
  projectDashboards,
} from "../entities/projectDashboards.ts";
import type { DashboardSummary } from "../schemas/dashboardSummarySchema.ts";
import { ProjectSlugService } from "../schemas/ProjectSlugService.ts";

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
 *
 * ## Slugs follow the project's own rules (#Q3299)
 *
 * A created or renamed dashboard's slug is derived from its name with
 * `ProjectSlugService.slugify`, unique in its project, and moves with a
 * rename, with no redirect kept. A name that transliterates to nothing gets
 * `dashboard-<id>`, and `^dashboard-\d+$` is reserved for exactly that, as
 * `project-<id>` is for projects.
 *
 * ## No reorder
 *
 * Order is creation order and nothing moves a dashboard: `position` is
 * written once, after the project's last, so that reordering can arrive
 * later with no migration.
 */
export class ProjectDashboardService {
  protected readonly dashboards = $repository(projectDashboards);
  protected readonly cards = $repository(projectDashboardCards);
  protected readonly slugs = $inject(ProjectSlugService);

  /**
   * Reserved for {@link fallbackSlug}: a dashboard named "Dashboard 3" may
   * not claim the slug that belongs to dashboard #3.
   */
  protected readonly fallbackPattern = /^dashboard-\d+$/;

  /**
   * The slug of a dashboard whose name transliterates to nothing, or that
   * has none. Unique by construction: dashboard ids are.
   */
  fallbackSlug(dashboardId: number): string {
    return `dashboard-${dashboardId}`;
  }

  /**
   * What the selector lists: every dashboard in order, and the implicit
   * first as an entry with no id while a project has no row.
   */
  async summaries(projectId: number): Promise<DashboardSummary[]> {
    const rows = await this.list(projectId);
    if (rows.length === 0) {
      return [{ position: 0, first: true }];
    }
    return rows.map((row, index) => this.toSummary(row, index === 0));
  }

  /**
   * A row as the browser reads it.
   */
  toSummary(
    row: ProjectDashboard | undefined,
    first: boolean,
  ): DashboardSummary {
    if (!row) {
      return { position: 0, first };
    }
    return {
      id: row.id,
      name: row.name ?? undefined,
      slug: row.slug ?? undefined,
      position: row.position,
      first,
    };
  }

  /**
   * The dashboard a URL names: by its slug, or by `dashboard-<id>` when it
   * has none, and the first when no slug is given. An unknown slug is a 404.
   */
  async targetBySlug(
    projectId: number,
    slug?: string,
  ): Promise<DashboardTarget> {
    if (slug === undefined || slug === "") {
      return this.target(projectId);
    }
    let row = await this.dashboards.findOne({
      where: { projectId: { eq: projectId }, slug: { eq: slug } },
    });
    const fallback = this.fallbackPattern.test(slug)
      ? Number(slug.slice("dashboard-".length))
      : undefined;
    if (!row && fallback !== undefined) {
      row = await this.dashboards.findOne({
        where: {
          id: { eq: fallback },
          projectId: { eq: projectId },
          slug: { isNull: true },
        },
      });
    }
    if (!row) {
      throw new NotFoundError("Dashboard not found");
    }
    return this.target(projectId, row.id);
  }

  /**
   * A new dashboard, after the project's last.
   *
   * In a project whose first dashboard is still implicit, the first's row is
   * created before the new one, so the new one is never first by accident.
   */
  async create(projectId: number, name: string): Promise<ProjectDashboard> {
    const trimmed = this.nameOf(name);
    await this.targetForWrite(projectId);
    const slug = this.slugs.slugify(trimmed);
    if (slug) {
      await this.assertSlugAvailable(projectId, slug);
    }
    const [last] = await this.dashboards.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "position", direction: "desc" }],
      limit: 1,
    });
    const row = await this.dashboards.create({
      projectId,
      name: trimmed,
      slug: slug || undefined,
      position: (last?.position ?? -1) + 1,
    });
    if (slug) {
      return row;
    }
    return this.dashboards.updateOne(
      { id: { eq: row.id } },
      { slug: this.fallbackSlug(row.id) },
    );
  }

  /**
   * A new name, and the slug derived from it: the URL moves with the name,
   * and the old one is not kept. No dashboard named means the first, whose
   * row is created when it is still implicit.
   */
  async rename(
    projectId: number,
    dashboardId: number | undefined,
    name: string,
  ): Promise<ProjectDashboard> {
    const trimmed = this.nameOf(name);
    const { row } = await this.targetForWrite(projectId, dashboardId);
    const slug = this.slugs.slugify(trimmed) || this.fallbackSlug(row.id);
    if (slug !== this.fallbackSlug(row.id)) {
      await this.assertSlugAvailable(projectId, slug, row.id);
    }
    return this.dashboards.updateOne(
      { id: { eq: row.id } },
      { name: trimmed, slug },
    );
  }

  /**
   * Delete a dashboard and its cards, the cards first.
   *
   * D1 has no transaction, so the order is what makes a delete that stopped
   * half-way finishable: a second call finds the dashboard still there and
   * deletes what is left. The foreign key's cascade is the backstop.
   *
   * The last dashboard cannot be deleted, and neither can the implicit one
   * of a project with no row, which is by definition its last. Deleting the
   * first takes the cards with no dashboard with it, since they are the
   * first's, and the next dashboard becomes the first.
   */
  async remove(projectId: number, dashboardId?: number): Promise<number> {
    const target = await this.target(projectId, dashboardId);
    const all = await this.dashboards.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id"],
    });
    if (!target.row || all.length <= 1) {
      throw new BadRequestError("The last dashboard cannot be deleted");
    }
    const deleted = await this.cards.deleteMany(
      target.first
        ? {
            projectId: { eq: projectId },
            or: [
              { dashboardId: { eq: target.row.id } },
              { dashboardId: { isNull: true } },
            ],
          }
        : {
            projectId: { eq: projectId },
            dashboardId: { eq: target.row.id },
          },
    );
    await this.dashboards.deleteMany({ id: { eq: target.row.id } });
    return deleted.length;
  }

  /**
   * A name as stored: trimmed, 1 to 60 characters, as a card's section.
   */
  protected nameOf(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 60) {
      throw new BadRequestError("A dashboard name is 1 to 60 characters");
    }
    return trimmed;
  }

  /**
   * Refuse a reserved slug, and one another dashboard of the project holds,
   * by that dashboard's name.
   */
  protected async assertSlugAvailable(
    projectId: number,
    slug: string,
    exceptDashboardId?: number,
  ): Promise<void> {
    if (this.fallbackPattern.test(slug)) {
      throw new BadRequestError(`The name "${slug}" is reserved`);
    }
    const holder = await this.dashboards.findOne({
      where: { projectId: { eq: projectId }, slug: { eq: slug } },
    });
    if (holder && holder.id !== exceptDashboardId) {
      throw new ConflictError(
        `The dashboard "${holder.name ?? slug}" already uses this name`,
      );
    }
  }

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
