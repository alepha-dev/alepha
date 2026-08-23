import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, NotFoundError } from "alepha/server";

import { type Project, projects } from "../entities/projects.ts";
import { type Sigil, sigils } from "../entities/sigils.ts";
import { relations } from "../relations.ts";
import type { DashboardScope } from "../schemas/dashboardScopeSchema.ts";

/**
 * A scope after it has been proven against the caller's memberships.
 *
 * Every id in it is one the caller may read. Downstream resolvers narrow with
 * these lists and never with anything the client sent.
 */
export interface ResolvedDashboardScope {
  /**
   * Projects in scope. `all` expands to every project the caller belongs to.
   */
  projectIds: number[];
  projects: Project[];
  /**
   * Apps in scope. Only a `kind: "apps"` scope sets it.
   */
  sigilIds?: string[];
  sigils: Sigil[];
}

/**
 * The security boundary of the dashboard, and the only place a card's scope
 * turns into a set of ids a query may use.
 *
 * Every other count endpoint in Lore is `/projects/:projectId/…` behind
 * `assertMember(projectId)`. A card scoped to several projects, or to apps
 * across projects, has no such single gate — so **every id must be proven
 * inside the caller's membership set before it narrows anything.** Skipping
 * that is a cross-tenant read.
 *
 * The proof generalises `InsightsController`'s: the membership check is on
 * the project, so a client-supplied id is proved against the caller's own set
 * first, and an id from outside it is a **404 rather than an empty answer** —
 * the two are different answers and "no such project here" is the true one.
 */
export class DashboardScopeService {
  protected readonly projects = $repository(projects);
  protected readonly sigils = $repository(sigils);
  protected readonly usersWith = $repository(relations, "users");

  /**
   * Structural validation of the tagged union.
   *
   * `dashboardScopeSchema` is a flat object because it doubles as a JSON
   * column, so the "exactly the payload its kind calls for" invariant has to
   * be checked rather than typed. This is that check, in one place.
   */
  assertWellFormed(scope: DashboardScope): void {
    const extras: Array<[string, boolean]> = [
      ["projectIds", !!scope.projectIds?.length],
      ["sigilIds", !!scope.sigilIds?.length],
      ["epicId", scope.epicId !== undefined],
      ["milestoneId", scope.milestoneId !== undefined],
    ];
    const expected: Record<DashboardScope["kind"], string | undefined> = {
      all: undefined,
      projects: "projectIds",
      apps: "sigilIds",
      epic: "epicId",
      milestone: "milestoneId",
    };
    const wanted = expected[scope.kind];

    for (const [name, present] of extras) {
      if (present && name !== wanted) {
        throw new BadRequestError(
          `A ${scope.kind} scope must not carry ${name}`,
        );
      }
    }
    if (wanted && !extras.find(([name]) => name === wanted)?.[1]) {
      throw new BadRequestError(`A ${scope.kind} scope requires ${wanted}`);
    }
  }

  /**
   * Every project the caller belongs to.
   *
   * Read through the `users.projects` membership relation, the same hop
   * `getHomeOverview` uses — the project creator gets a `members` row on
   * create, so the relation is the complete set and not just "projects
   * someone invited me to".
   */
  async visibleProjects(user: UserAccountToken): Promise<Project[]> {
    const me = await this.usersWith.findById(user.id, {
      include: { projects: true },
    });
    return (me?.projects ?? []) as Project[];
  }

  /**
   * Turn a stored scope into ids a query may narrow on.
   *
   * `visibleProjects` lets a caller resolving several scopes for one request
   * read the membership set **once**. Without it a ten-card board runs the
   * same users-to-projects join ten times, which is the shape this endpoint
   * exists to avoid. Omitted, it is read here.
   *
   * @throws NotFoundError when the scope names a project or app the caller
   * cannot see — deliberately, rather than silently returning an empty set.
   */
  async resolve(
    scope: DashboardScope,
    user: UserAccountToken,
    visibleProjects?: Project[],
  ): Promise<ResolvedDashboardScope> {
    this.assertWellFormed(scope);

    const visible = visibleProjects ?? (await this.visibleProjects(user));
    const visibleById = new Map(visible.map((it) => [it.id, it]));

    if (scope.kind === "all") {
      return {
        projectIds: visible.map((it) => it.id),
        projects: visible,
        sigils: [],
      };
    }

    if (scope.kind === "projects") {
      const inScope: Project[] = [];
      for (const id of scope.projectIds ?? []) {
        const project = visibleById.get(id);
        if (!project) {
          throw new NotFoundError("Project not found");
        }
        inScope.push(project);
      }
      return {
        projectIds: inScope.map((it) => it.id),
        projects: inScope,
        sigils: [],
      };
    }

    if (scope.kind === "apps") {
      const ids = scope.sigilIds ?? [];
      const rows = await this.sigils.findMany({
        where: { id: { inArray: ids } },
      });
      const byId = new Map(rows.map((it) => [it.id, it]));
      const inScope: Sigil[] = [];
      for (const id of ids) {
        const sigil = byId.get(id);
        // Two ways to fail, one answer: the app does not exist, or it exists
        // in a project the caller has nothing to do with. "No such app here"
        // is true either way, and distinguishing them would leak the second.
        if (!sigil || !visibleById.has(sigil.projectId)) {
          throw new NotFoundError("App not found");
        }
        inScope.push(sigil);
      }
      const projectIds = [...new Set(inScope.map((it) => it.projectId))];
      return {
        projectIds,
        projects: projectIds.map((id) => visibleById.get(id)!),
        sigilIds: inScope.map((it) => it.id),
        sigils: inScope,
      };
    }

    // `epic` and `milestone` are in the union for the deferred tiles. No v1
    // metric accepts either, so reaching here means a card was written past
    // the catalogue's `accepts()` gate.
    throw new BadRequestError(`Unsupported scope kind: ${scope.kind}`);
  }
}
