import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, NotFoundError } from "alepha/server";

import { type Project, projects } from "../entities/projects.ts";
import { coreRelations } from "../relations/coreRelations.ts";
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
  /**
   * What an `apps`, `epic` or `release` scope names, proven by the module
   * that owns it (#E75, #Q2623): the rows themselves, because the resolvers
   * need them and only this layer may read them. Empty for `all` and
   * `projects`.
   *
   * The whole row rather than an id, because the resolver is the only layer
   * that can carry an epic's per-project `number` or a release's `tag` across
   * to `link()`: a card that put an id where the page expects a number would
   * land on somebody else's epic, silently.
   */
  subjects: DashboardScopeSubject[];
}

/**
 * One thing an `apps`, `epic` or `release` scope names.
 */
export interface DashboardScopeSubject {
  /**
   * `app`, `epic` or `release`.
   */
  kind: string;
  id: string;
  projectId: number;
  /**
   * What the card's scope chip reads: an app's name, an epic's title, a
   * release's tag.
   */
  name: string;
  /**
   * The row, for the owning module's resolvers to read back.
   */
  row: unknown;
}

/**
 * Proves the subjects of one scope kind: every id must exist and belong to a
 * visible project, or the whole scope is a 404.
 */
export type DashboardScopeResolver = (
  scope: DashboardScope,
  visibleById: ReadonlyMap<number, Project>,
) => Promise<DashboardScopeSubject[]>;

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
 *
 * ⚠️ **ranks: imperative.** This file names `assertMember` and calls neither
 * it nor `assertOwner`: the proof is a set intersection, because a card scoped
 * to several projects has no single project to gate on. `$ownsProject` cannot
 * express that shape, so when a rank narrows what a card may count, it narrows
 * here, per id, and not in a `use:` entry.
 */
export class DashboardScopeService {
  protected readonly projects = $repository(projects);
  protected readonly resolvers = new Map<string, DashboardScopeResolver>();
  protected readonly usersWith = $repository(coreRelations, "users");

  /**
   * Register how a scope kind that names a module's rows is proven: `apps`
   * by Deploy, `epic` and `release` by Work (#E75, #Q2623). A kind no module
   * registered is refused, as an unsupported scope.
   */
  registerScope(
    kind: DashboardScope["kind"],
    resolver: DashboardScopeResolver,
  ): void {
    this.resolvers.set(kind, resolver);
  }

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
      ["releaseId", scope.releaseId !== undefined],
    ];
    const expected: Record<DashboardScope["kind"], string | undefined> = {
      all: undefined,
      projects: "projectIds",
      apps: "sigilIds",
      epic: "epicId",
      release: "releaseId",
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
   * @throws NotFoundError when the scope names a project, app, epic or
   * release the caller cannot see — deliberately, rather than silently
   * returning an empty set. Inside a project board the visible set is the
   * route's own project, so "belongs to this project" is the same proof
   * written once.
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
        subjects: [],
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
        subjects: [],
      };
    }

    // `apps`, `epic`, `release`: the module that owns the rows proves them,
    // and throws a 404 for one that does not exist or sits in a project the
    // caller has nothing to do with. "No such thing here" is true either way,
    // and distinguishing them would leak the second.
    const resolver = this.resolvers.get(scope.kind);
    if (resolver) {
      const subjects = await resolver(scope, visibleById);
      const projectIds = [...new Set(subjects.map((it) => it.projectId))];
      return {
        projectIds,
        projects: projectIds.map((id) => visibleById.get(id)!),
        ...(scope.kind === "apps"
          ? { sigilIds: subjects.map((it) => it.id) }
          : {}),
        subjects,
      };
    }

    throw new BadRequestError(`Unsupported scope kind: ${scope.kind}`);
  }
}
