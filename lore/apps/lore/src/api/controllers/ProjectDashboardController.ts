import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";

import { type Project, projects } from "../entities/projects.ts";
import { dashboardCardResourceSchema } from "../schemas/dashboardCardResourceSchema.ts";
import { dashboardCardValueSchema } from "../schemas/dashboardCardValueSchema.ts";
import {
  type DashboardScope,
  dashboardScopeSchema,
} from "../schemas/dashboardScopeSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { DashboardMetricRegistry } from "../services/DashboardMetricRegistry.ts";
import { DashboardScopeService } from "../services/DashboardScopeService.ts";
import { ProjectDashboardCardService } from "../services/ProjectDashboardCardService.ts";

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
 * have needed anyway, since `ProjectRankJobs.seedMissingPresetRanks` only
 * seeds projects holding zero rank rows and would have reached none of the
 * existing ones.
 *
 * ## ⚠️ No reset
 *
 * On a shared board, Reset is one member discarding everybody's configuration
 * in one click. Home's is gone too (#Q2145), so there is no surface left to
 * mirror and nothing here should grow one. Removing a card at a time is the
 * way back, and it is also the way anybody got there.
 *
 * ## Nothing seeds
 *
 * {@link listCards} returns what is stored, which on a new project is an empty
 * array, and it writes nothing on the way. See `projectDashboardCards` for
 * why that means there is no marker table either.
 */
export class ProjectDashboardController {
  protected readonly cards = $inject(ProjectDashboardCardService);
  protected readonly scopes = $inject(DashboardScopeService);
  protected readonly registry = $inject(DashboardMetricRegistry);
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
   * This project's cards, in grid order.
   */
  listProjectDashboardCards = $action({
    use: [this.ownsProject("project:read")],
    method: "GET",
    path: "/projects/:projectId/dashboard/cards",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({
        cards: z.array(dashboardCardResourceSchema),
      }),
    },
    handler: async ({ params }) => ({
      cards: await this.cards.list(params.projectId),
    }),
  });

  addProjectDashboardCard = $action({
    use: [this.ownsProject("project:update")],
    method: "POST",
    path: "/projects/:projectId/dashboard/cards",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        metric: z.string().min(1).max(64),
        scope: dashboardScopeSchema,
        filters: z.record(z.text(), z.any()).optional(),
        size: z.integer().min(1).max(6).optional(),
      }),
      response: dashboardCardResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      this.cards.add(params.projectId, {
        metric: body.metric,
        scope: await this.proveScope(params.projectId, body.scope, user),
        filters: body.filters,
        size: body.size,
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
      body: z.object({ ids: z.array(z.integer()).max(100) }),
      response: z.object({ cards: z.array(dashboardCardResourceSchema) }),
    },
    handler: async ({ params, body }) => {
      await this.cards.reorder(params.projectId, body.ids);
      return { cards: await this.cards.list(params.projectId) };
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
    handler: async ({ params, body, user }) => {
      const project = await this.projectOf(params.projectId);
      const all = await this.cards.list(params.projectId);
      const wanted = body.cardIds ? new Set(body.cardIds) : undefined;
      const cards = wanted ? all.filter((card) => wanted.has(card.id)) : all;

      return {
        values: await this.registry.resolveForProject(cards, user, project),
        refreshedAt: this.dateTime.now().toISOString(),
      };
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
