import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import {
  $action,
  BadRequestError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import { type Project, projects } from "../entities/projects.ts";
import { dashboardCardResourceSchema } from "../schemas/dashboardCardResourceSchema.ts";
import { dashboardCardValueSchema } from "../schemas/dashboardCardValueSchema.ts";
import {
  type DashboardScope,
  dashboardScopeSchema,
} from "../schemas/dashboardScopeSchema.ts";
import { dashboardSummarySchema } from "../schemas/dashboardSummarySchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { DashboardMetricRegistry } from "../services/DashboardMetricRegistry.ts";
import { DashboardScopeService } from "../services/DashboardScopeService.ts";
import { DashboardSlotRegistry } from "../services/DashboardSlotRegistry.ts";
import { ProjectDashboardCardService } from "../services/ProjectDashboardCardService.ts";
import { ProjectDashboardService } from "../services/ProjectDashboardService.ts";
import { ProjectRecencyService } from "../services/ProjectRecencyService.ts";

/**
 * One project's board: read it, and curate it.
 *
 * ## The security shape is simpler than home's, and that is the point
 *
 * `DashboardScopeService` proves ids by set intersection because a HOME card
 * can name several projects, or apps spanning them, so there is no single
 * project to gate on. A project board has one gate again, and it is the one
 * every other `/projects/:projectId/...` endpoint in Lore already uses.
 *
 * What survives of the intersection is smaller and still real: a card's scope
 * may name a sigil, an epic or a release, and each must be proved to belong
 * to **this** project. That is the same method, handed the route's project as
 * the entire visible set - so an id from another project is a 404 rather than
 * an empty answer, which is the rule the existing service establishes.
 *
 * ## The gate
 *
 * **Reads are `project:read`**, the floor every rank holds, so this is
 * membership and nothing more. **Writes are `project:update`**, and the
 * consequence is accepted rather than worked around: `ProjectRankPresets`
 * gives it to the owner and to Admin, not to Contributor or Viewer, so a
 * shared board is curated by the people who configure the project and read by
 * everybody else. A project that wants otherwise ticks the box in its own
 * rank matrix - which is the same click a minted `dashboard:manage` would
 * have needed anyway.
 *
 * ## Reset came back with the computed board (#Q2660)
 *
 * It was refused while a project board had no default to return to: Reset
 * meant one member discarding everybody's configuration for an empty page
 * (#Q2145). Since #E77 the default is the computed board, so "Reset to
 * default" returns the project to something, and Customize is its inverse:
 * both are `project:update`, both behind the board's own controls.
 *
 * ## Nothing seeds, and a board with no cards is COMPUTED (#E77)
 *
 * {@link listProjectDashboardCards} returns what is stored, which on a new
 * project is an empty array, and it writes nothing on the way. See
 * `projectDashboardCards` for why that means there is no marker table either.
 *
 * {@link getProjectDashboard} is what the page loads: the stored cards and
 * their values when there are any, and otherwise the default board
 * `DashboardSlotRegistry` computes from the project's capabilities and data,
 * resolved live and never written (folio #F1364).
 *
 * ## A project holds several dashboards (#E127, #Q3299)
 *
 * Dashboards are listed, created, renamed and deleted here, writes under
 * `project:update` as the cards' are. Every card route that is not keyed by
 * a card id takes an optional `dashboardId` in its query, and none means the
 * project's first: the routes keep their shape for a caller that knows one
 * board. Updating and removing a card stay keyed by the card's id, which
 * already names its dashboard. A dashboard of another project is a 404.
 *
 * **Only the first is computed.** The first dashboard, while it has no
 * stored card, answers the computed board, and only it can be dormant.
 * Any other with no card answers no card, which the page shows as the empty
 * board. So Customize is refused anywhere else (nothing is computed there to
 * copy), while Reset empties whichever dashboard it names.
 */
export class ProjectDashboardController {
  protected readonly cards = $inject(ProjectDashboardCardService);
  protected readonly dashboards = $inject(ProjectDashboardService);
  protected readonly scopes = $inject(DashboardScopeService);
  protected readonly registry = $inject(DashboardMetricRegistry);
  protected readonly slots = $inject(DashboardSlotRegistry);
  protected readonly recency = $inject(ProjectRecencyService);

  /**
   * How long without a recorded write before a project is dormant (#Q2662).
   */
  protected static readonly DORMANT_AFTER_DAYS = 90;
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly projects = $repository(projects);

  /**
   * Declared above the actions, the way `EpicController` does it: `use:`
   * evaluates at class-construction time, so a gate reached through `this`
   * has to exist before the first action that names it.
   */
  protected ownsProject = (requires: string) =>
    $ownsProject({ requires, param: "projectId" });

  /**
   * The dashboard a card route acts on; none means the project's first.
   */
  protected static readonly onDashboard = z.object({
    dashboardId: z.integer().optional(),
  });

  /**
   * This project's dashboards in creation order, which is their order. A
   * project with no row lists its implicit first, with no id.
   */
  listProjectDashboards = $action({
    use: [this.ownsProject("project:read")],
    method: "GET",
    path: "/projects/:projectId/dashboards",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ dashboards: z.array(dashboardSummarySchema) }),
    },
    handler: async ({ params }) => ({
      dashboards: await this.dashboards.summaries(params.projectId),
    }),
  });

  /**
   * A new dashboard, after the project's last. It opens empty: only the
   * first dashboard is computed.
   */
  createProjectDashboard = $action({
    use: [this.ownsProject("project:update")],
    method: "POST",
    path: "/projects/:projectId/dashboards",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({ name: z.string().min(1).max(60) }),
      response: dashboardSummarySchema,
    },
    handler: async ({ params, body }) =>
      this.dashboards.toSummary(
        await this.dashboards.create(params.projectId, body.name),
        false,
      ),
  });

  /**
   * A new name, and with it a new slug: the dashboard's URL moves, and the
   * old one is not kept. No `dashboardId` renames the first.
   */
  renameProjectDashboard = $action({
    use: [this.ownsProject("project:update")],
    method: "PATCH",
    path: "/projects/:projectId/dashboard",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: ProjectDashboardController.onDashboard,
      body: z.object({ name: z.string().min(1).max(60) }),
      response: dashboardSummarySchema,
    },
    handler: async ({ params, query, body }) => {
      const row = await this.dashboards.rename(
        params.projectId,
        query.dashboardId,
        body.name,
      );
      const first = await this.dashboards.first(params.projectId);
      return this.dashboards.toSummary(row, first?.id === row.id);
    },
  });

  /**
   * Delete a dashboard and its cards. The last one cannot be deleted.
   */
  deleteProjectDashboard = $action({
    use: [this.ownsProject("project:update")],
    method: "DELETE",
    path: "/projects/:projectId/dashboard",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: ProjectDashboardController.onDashboard,
      response: z.object({ ok: z.boolean(), deletedCards: z.integer() }),
    },
    handler: async ({ params, query }) => ({
      ok: true,
      deletedCards: await this.dashboards.remove(
        params.projectId,
        query.dashboardId,
      ),
    }),
  });

  /**
   * This project's cards, in grid order.
   */
  listProjectDashboardCards = $action({
    use: [this.ownsProject("project:read")],
    method: "GET",
    path: "/projects/:projectId/dashboard/cards",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: ProjectDashboardController.onDashboard,
      response: z.object({
        cards: z.array(dashboardCardResourceSchema),
      }),
    },
    handler: async ({ params, query }) => ({
      cards: await this.cards.list(params.projectId, query.dashboardId),
    }),
  });

  addProjectDashboardCard = $action({
    use: [this.ownsProject("project:update")],
    method: "POST",
    path: "/projects/:projectId/dashboard/cards",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: ProjectDashboardController.onDashboard,
      body: z.object({
        metric: z.string().min(1).max(64),
        scope: dashboardScopeSchema,
        filters: z.record(z.text(), z.any()).optional(),
        size: z.integer().min(1).max(6).optional(),
        height: z.integer().min(1).max(2).optional(),
        section: z.string().max(60).optional(),
      }),
      response: dashboardCardResourceSchema,
    },
    handler: async ({ params, query, body, user }) =>
      this.cards.add(params.projectId, query.dashboardId, {
        metric: body.metric,
        scope: await this.proveScope(params.projectId, body.scope, user),
        filters: body.filters,
        size: body.size,
        height: body.height,
        section: body.section,
      }),
  });

  updateProjectDashboardCard = $action({
    use: [this.ownsProject("project:update")],
    method: "PATCH",
    path: "/projects/:projectId/dashboard/cards/:cardId",
    schema: {
      params: z.object({ projectId: z.integer(), cardId: z.integer() }),
      body: z.object({
        metric: z.string().min(1).max(64).optional(),
        scope: dashboardScopeSchema.optional(),
        filters: z.record(z.text(), z.any()).optional(),
        size: z.integer().min(1).max(6).optional(),
        height: z.integer().min(1).max(2).optional(),
        section: z.string().max(60).optional(),
      }),
      response: dashboardCardResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      this.cards.update(params.projectId, params.cardId, {
        metric: body.metric,
        scope: body.scope
          ? await this.proveScope(params.projectId, body.scope, user)
          : undefined,
        filters: body.filters,
        size: body.size,
        height: body.height,
        section: body.section,
      }),
  });

  removeProjectDashboardCard = $action({
    use: [this.ownsProject("project:update")],
    method: "DELETE",
    path: "/projects/:projectId/dashboard/cards/:cardId",
    schema: {
      params: z.object({ projectId: z.integer(), cardId: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.cards.remove(params.projectId, params.cardId);
      return { ok: true };
    },
  });

  /**
   * Persist a new grid order.
   *
   * The body is the complete id list, in the order the grid now shows - a
   * drag is described by where everything ended up, not by what moved. A
   * partial list is refused rather than interpreted.
   */
  reorderProjectDashboardCards = $action({
    use: [this.ownsProject("project:update")],
    method: "POST",
    path: "/projects/:projectId/dashboard/cards/order",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: ProjectDashboardController.onDashboard,
      body: z.object({ ids: z.array(z.integer()).max(100) }),
      response: z.object({ cards: z.array(dashboardCardResourceSchema) }),
    },
    handler: async ({ params, query, body }) => {
      await this.cards.reorder(params.projectId, query.dashboardId, body.ids);
      return {
        cards: await this.cards.list(params.projectId, query.dashboardId),
      };
    },
  });

  /**
   * Turn the whole card list into values, in one request.
   *
   * ⚠️ **One endpoint, and no polling.** Ten auto-refreshing tiles is the
   * exact shape of the QuestGraph incident (folio #1057) - 4,009 identical
   * `/api/_batch` requests from one browser tab in 51 minutes. `/api/_batch`
   * collapses transport, not database work, so this takes the whole list and
   * `DashboardMetricRegistry` groups it by metric.
   *
   * The cards are read from storage rather than taken from the body: they are
   * the project's own rows, the server is already the source of truth for
   * them, and a body-supplied list would only add a way for the two to
   * disagree.
   */
  resolveProjectDashboardCards = $action({
    use: [this.ownsProject("project:read")],
    method: "POST",
    path: "/projects/:projectId/dashboard/resolve",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: ProjectDashboardController.onDashboard,
      body: z.object({
        cardIds: z.array(z.integer()).max(100).optional(),
      }),
      response: z.object({
        values: z.array(dashboardCardValueSchema),
        /**
         * When these numbers were read. A timestamp on an explicit resolve,
         * never a heartbeat.
         */
        refreshedAt: z.string(),
      }),
    },
    handler: async ({ params, query, body, user }) => {
      const project = await this.projectOf(params.projectId);
      const all = await this.cards.list(params.projectId, query.dashboardId);
      const wanted = body.cardIds ? new Set(body.cardIds) : undefined;
      const cards = wanted ? all.filter((card) => wanted.has(card.id)) : all;

      return {
        values: await this.registry.resolveForProject(cards, user, project),
        refreshedAt: this.dateTime.now().toISOString(),
      };
    },
  });

  /**
   * "Customize": copy the tiles the computed board renders into stored cards,
   * in one write, and return them (#Q2660). From then on the stored cards
   * win and the slots no longer apply.
   *
   * The tiles copied are the ones the computed board shows the caller right
   * now: a `viewer` tile is copied as the viewer scope, which carries no id,
   * so it keeps showing each reader their own.
   */
  customizeProjectDashboard = $action({
    use: [this.ownsProject("project:update")],
    method: "POST",
    path: "/projects/:projectId/dashboard/customize",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: ProjectDashboardController.onDashboard,
      response: z.object({ cards: z.array(dashboardCardResourceSchema) }),
    },
    handler: async ({ params, query, user }) => {
      const target = await this.dashboards.target(
        params.projectId,
        query.dashboardId,
      );
      if (!target.first) {
        throw new BadRequestError(
          "Only the first dashboard has a computed board to customize",
        );
      }
      const project = await this.projectOf(params.projectId);
      const computed = await this.slots.compute(project, user);
      return {
        cards: await this.cards.copy(
          params.projectId,
          target.row?.id,
          computed.cards.map((card) => ({
            metric: card.metric,
            scope: card.scope,
            filters: card.filters,
            size: card.size,
            height: card.height,
            section: card.section,
          })),
        ),
      };
    },
  });

  /**
   * "Reset to default": delete every stored card of the dashboard named, so
   * every member sees the computed board again on their next load (#Q2660).
   * On a dashboard that is not the first, that leaves it empty.
   */
  resetProjectDashboard = $action({
    use: [this.ownsProject("project:update")],
    method: "DELETE",
    path: "/projects/:projectId/dashboard/cards",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: ProjectDashboardController.onDashboard,
      response: okSchema,
    },
    handler: async ({ params, query }) => {
      await this.cards.reset(params.projectId, query.dashboardId);
      return { ok: true };
    },
  });

  /**
   * The whole board in one request: what the page's loader calls.
   *
   * ⚠️ **Stored cards win.** A dashboard with at least one stored card is a
   * customized board and gets exactly those, resolved. Only the FIRST
   * dashboard with none gets the computed board (any other answers no card), so `computed` says which the reader is
   * looking at, and a computed board is read-only for everyone.
   *
   * One request per load, and one resolve inside it grouped by metric
   * (folio #1057). No polling.
   */
  getProjectDashboard = $action({
    use: [this.ownsProject("project:read")],
    method: "GET",
    path: "/projects/:projectId/dashboard",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        /**
         * The board's window in days (#Q2661), one for every tile. The
         * reader's preference, never stored on the board.
         */
        window: z.enum(["7", "14", "30"]).optional(),
        /**
         * The dashboard's slug (#Q3299), or `dashboard-<id>` for one with
         * none. Absent means the first. An unknown slug is a 404.
         */
        dashboard: z.string().max(80).optional(),
      }),
      response: z.object({
        /**
         * The dashboard served, and every dashboard of the project for the
         * selector: the page still loads in one request (folio #F1057).
         */
        dashboard: dashboardSummarySchema,
        dashboards: z.array(dashboardSummarySchema),
        computed: z.boolean(),
        /**
         * When a dormant project last moved (#Q2662): no recorded write in
         * 90 days. Only on a computed board; a customized one is the
         * owner's and is left alone.
         */
        dormantSince: z.string().optional(),
        cards: z.array(dashboardCardResourceSchema),
        values: z.array(dashboardCardValueSchema),
        refreshedAt: z.string(),
      }),
    },
    handler: async ({ params, query, user }) => {
      const project = await this.projectOf(params.projectId);
      const target = await this.dashboards.targetBySlug(
        params.projectId,
        query.dashboard,
      );
      const stored = await this.cards.listOn(target);
      const refreshedAt = this.dateTime.now().toISOString();
      const windowDays = Number(query.window ?? 14);
      const dashboard = this.dashboards.toSummary(target.row, target.first);
      const dashboards = await this.dashboards.summaries(params.projectId);

      if (stored.length > 0 || !target.first) {
        return {
          dashboard,
          dashboards,
          computed: false,
          cards: stored,
          values: await this.registry.resolveForProject(
            stored,
            user,
            project,
            undefined,
            windowDays,
          ),
          refreshedAt,
        };
      }

      // Dormant (#Q2662): a page of slots that would all collapse becomes one
      // line and what the project shipped last.
      const [last] = await this.recency.lastActivity([
        { id: project.id, updatedAt: project.updatedAt },
      ]);
      const quietFor = this.dateTime.nowMillis() - Date.parse(last!.at);
      if (
        quietFor >
        ProjectDashboardController.DORMANT_AFTER_DAYS * 86_400_000
      ) {
        const board = await this.slots.compute(project, user, windowDays, {
          dormant: true,
        });
        return {
          dashboard,
          dashboards,
          computed: true,
          dormantSince: last!.at,
          ...board,
          refreshedAt,
        };
      }

      const board = await this.slots.compute(project, user, windowDays);
      return { dashboard, dashboards, computed: true, ...board, refreshedAt };
    },
  });

  /**
   * The scope as it will be stored, proved against this project.
   *
   * Two things happen here and neither belongs to the storage service, which
   * does not know which project the route named.
   *
   * **`all` and `projects` are forced to the route's own id.** Inside a
   * project both mean "this project", and the reader was never asked - see
   * `DashboardMetricCatalog.forcedScope`. Taking the ids from the body would
   * let a project board point at another project, which is exactly what the
   * gate above exists to prevent.
   *
   * **Everything else is proved to belong here.** `DashboardScopeService` is
   * handed the route's project as the whole visible set, so its existing
   * membership test reads as "belongs to this project" with no second
   * convention beside it, and an id from elsewhere answers 404.
   */
  protected async proveScope(
    projectId: number,
    scope: DashboardScope,
    user: UserAccountToken,
  ): Promise<DashboardScope> {
    const forced: DashboardScope =
      scope.kind === "all" || scope.kind === "projects"
        ? { kind: "projects", projectIds: [projectId] }
        : scope;

    const project = await this.projectOf(projectId);
    await this.scopes.resolve(forced, user, [project]);
    return forced;
  }

  /**
   * The project row, which `resolveForProject` needs as the visible set.
   *
   * The gate has already proved membership, so a missing row here means the
   * project was deleted between the gate and the handler.
   */
  protected async projectOf(projectId: number): Promise<Project> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    if (!project) {
      throw new NotFoundError("Project not found");
    }
    return project;
  }
}
