import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import {
  ResourceGateMemoProvider,
  type UserAccountToken,
} from "alepha/security";
import { ForbiddenError } from "alepha/server";

import { type Member, members } from "../entities/members.ts";
import {
  type ProjectCapability,
  projectCapabilities,
} from "../entities/projectCapabilities.ts";
import { type Project, projects } from "../entities/projects.ts";
import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import type { RoadmapVisibility } from "../schemas/roadmapVisibilitySchema.ts";
import { CapabilityRegistry } from "./CapabilityRegistry.ts";

/**
 * Project access gates.
 *
 * Deliberately separate from `AppSecurityProvider`, which declares the
 * `$realm`. `$realm` registers services into the container from inside a
 * class-field initializer, so anything that both declares it *and* is widely
 * injected becomes a hub in the dependency graph — `LoreFileAccessProvider`
 * needs a membership check, and injecting the realm-declaring class from
 * there closed a loop back into its own construction.
 *
 * Authorization is domain logic; realm configuration is infrastructure. They
 * do not belong in one class.
 *
 * ## Two roles, and the newer one is the default
 *
 * This class both PERFORMS the check ({@link assertMember} /
 * {@link assertOwner}, called from a handler body) and SUPPLIES it
 * (`projects` and `members`, which `$ownsProject` joins declaratively in a
 * `use:` array). A new endpoint takes the second: a gate in `use:` cannot be
 * forgotten the way a missing line in a handler can, it runs before the
 * handler on every transport including MCP, and it hands the rows it read to
 * the handler instead of making it query them again.
 *
 * The assert methods remain for the controllers not yet ported, and
 * {@link isMember} / {@link isMemberById} are not going anywhere at all -
 * they answer questions that are not gates.
 */
export class ProjectSecurityService {
  projects = $repository(projects);
  members = $repository(members);
  /**
   * The project's enabled capabilities, one row per enabled key.
   *
   * Declared here rather than beside a caller because this is where the
   * cached read lands: capabilities are configuration, exactly what
   * `features.*` was, so they take the project row's treatment above rather
   * than membership's.
   */
  capabilities = $repository(projectCapabilities);
  protected readonly registry = $inject(CapabilityRegistry);
  protected readonly memo = $inject(ResourceGateMemoProvider);

  /**
   * How long `assertMember`'s project read may be served from the ORM's
   * in-memory query cache.
   *
   * This one row is read by EVERY project-scoped request in the app —
   * same query, same params — so it is the highest-value cacheable read
   * there is. Writes through `projects` invalidate the whole table's
   * entries automatically (`Repository` calls `invalidateTable` on every
   * mutation path), so the window only ever applies to a write made by a
   * DIFFERENT process: `DbCacheProvider` is a per-process `Map`, and on
   * Workers that means per isolate.
   *
   * 30s is what that cross-isolate staleness is worth here. The values
   * it gates are `features.*` toggles and `retentionDays` — a settings
   * change taking up to half a minute to reach another isolate is fine.
   */
  public static readonly PROJECT_CACHE_TTL_MS = 30_000;

  /**
   * Request-memo key prefix for {@link capabilitiesOf}.
   *
   * Namespaced rather than a bare id: the memo `Map` is shared with `$owns`,
   * which keys its own authority and membership reads into the same store.
   */
  public static readonly CAPABILITY_MEMO_PREFIX = "lore.projectCapabilities:";

  /**
   * Membership gate. Requires the caller to be the project owner or a
   * member (membership row exists). Used for every project-scoped read
   * AND write — Lore projects are always private; there is no
   * non-member visibility path.
   *
   * `user.ownership === false` is a privileged identity (admin without
   * narrow ownership scope) and bypasses the membership check.
   */
  async assertMember(
    projectId: number,
    user: UserAccountToken,
  ): Promise<ProjectGuard> {
    const project = await this.projects.getOne(
      { where: { id: { eq: projectId } } },
      { cache: { ttl: ProjectSecurityService.PROJECT_CACHE_TTL_MS } },
    );

    // `=== false`, not a falsy test: the token only carries `ownership` when
    // `$secure` was given permissions. On a bare `$secure()` action it is
    // `undefined`, and `!user.ownership` let every logged-in user through.
    if (project.createdBy === user.id || user.ownership === false) {
      return { project };
    }

    // Deliberately NOT cached, unlike the project read above. `createdBy`
    // is immutable, so a stale project row cannot widen the owner branch
    // — but membership is revocable, and caching this would keep a
    // removed member reading the project for the length of the window.
    const member = await this.members.findOne({
      where: {
        projectId: { eq: projectId },
        userId: { eq: user.id },
      },
    });

    if (!member) {
      throw new ForbiddenError("Not a member of this project");
    }
    return { project, member };
  }

  /**
   * Non-throwing **literal** membership check — `true` when the caller created
   * the project or holds a membership in it.
   *
   * Unlike {@link assertMember}, this deliberately does NOT honor the
   * `user.ownership` privileged-identity bypass: that bypass governs *access*
   * (a privileged admin may read member-gated data), whereas this answers
   * "does the caller *belong* to this project?". Used to branch on membership
   * (e.g. exempting members from the feedback rate limit), not to gate access.
   */
  async isMember(projectId: number, user: UserAccountToken): Promise<boolean> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    if (!project) {
      return false;
    }
    if (project.createdBy === user.id) {
      return true;
    }
    const member = await this.members.findOne({
      where: {
        projectId: { eq: projectId },
        userId: { eq: user.id },
      },
    });
    return !!member;
  }

  /**
   * Membership by raw user id, for questions about **somebody else**.
   *
   * {@link isMember} answers "does the caller belong here" and takes a
   * token; this answers "does that person belong here", which is what
   * handing a quest over needs — the caller is authorized, the assignee is
   * the one being checked. Same literal rule: creator, or a membership row.
   *
   * Deliberately not folded into `isMember` with a union parameter: the two
   * are asked in different situations and conflating them is how a check
   * ends up validating the wrong subject.
   */
  async isMemberById(projectId: number, userId: string): Promise<boolean> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    if (!project) {
      return false;
    }
    if (project.createdBy === userId) {
      return true;
    }
    const member = await this.members.findOne({
      where: {
        projectId: { eq: projectId },
        userId: { eq: userId },
      },
    });
    return !!member;
  }

  /**
   * The roadmap's own gate, and the only one in the app that can answer
   * "yes" to a caller with no session at all.
   *
   * `off` refuses everyone, `members` requires membership, `public` allows
   * anonymous. Both roadmap actions call this so the members page and the
   * public endpoint share one decision instead of re-deriving it - a page and
   * an endpoint that disagree about who may read something is how a leak
   * survives a green test.
   *
   * ## Why a service method and not a `$roadmapVisible` middleware
   *
   * Every other gate in the app is a middleware now (`$ownsProject`), and a
   * lone service method is the odd one out. It stays one for a concrete
   * reason rather than inertia: `$owns` is built ON `$secure`
   * (`$owns.ts` returns `$secure({ guard })`), so a middleware in that family
   * cannot run on an action that has no authenticated caller - which is
   * precisely the case this gate exists for. A middleware here would have to
   * be a second, parallel mechanism that only the roadmap uses, which is
   * worse than one method both actions call.
   *
   * ⚠️ **Turning the roadmap off is not instant.** The `project` row reaches
   * these callers through the 30 second window in
   * {@link PROJECT_CACHE_TTL_MS}, and it carries `roadmapVisibility` with it.
   * Carving out one uncached read for this path was considered and rejected:
   * it makes the roadmap the single exception to a rule that holds
   * everywhere else, for a page nobody hits in a loop, to close a window
   * measured in seconds. The settings card discloses the window instead
   * (`project.settings.roadmap.delay`).
   *
   * Returns `false` rather than throwing: the caller 404s, and it must be a
   * 404 rather than a 403 because a 403 confirms the project exists.
   */
  async isRoadmapVisible(
    project: Project,
    user?: UserAccountToken,
  ): Promise<boolean> {
    const visibility = this.roadmapVisibilityOf(project);
    if (visibility === "public") {
      return true;
    }
    if (visibility === "off" || !user) {
      return false;
    }
    return await this.isMember(project.id, user);
  }

  /**
   * The `off` fallback for a row written before the column existed.
   *
   * It lives here and NOT in a column `DEFAULT`: a DEFAULT on `projects`
   * triggers the D1 table rebuild that cascade-wipes members, quests,
   * releases, folios and feedback. See `roadmapVisibilitySchema`.
   *
   * Defaulting closed is the only safe reading - an absent value must never
   * publish anything.
   */
  roadmapVisibilityOf(project: Project): RoadmapVisibility {
    return project.roadmapVisibility ?? "off";
  }

  /**
   * Owner-only gate. Requires the caller to be the project creator (or a
   * privileged identity with `user.ownership === false`). Use for
   * destructive or project-configuration endpoints: delete project,
   * change features, manage kanban columns, manage releases, import quests,
   * send invitations.
   */
  async assertOwner(
    projectId: number,
    user: UserAccountToken,
  ): Promise<ProjectGuard> {
    const project = await this.projects.getOne({
      where: { id: { eq: projectId } },
    });

    // Same rule as assertMember: undefined is NOT the privileged identity.
    if (project.createdBy !== user.id && user.ownership !== false) {
      throw new ForbiddenError(
        "Only the project owner can perform this action",
      );
    }

    return { project };
  }

  /**
   * Which capabilities this project has turned on, and the options inside
   * each.
   *
   * One query on `project_capabilities`, never a join onto `projects`: the
   * project row is read through a keyed `getOne` whose cache entry the whole
   * application shares, and a join changes that key. Two statements, both
   * cheap, is the shape Ranks then hangs its own definitions read off - two
   * tables belonging to two modules, issued concurrently rather than joined,
   * because a cross-module join is what folio #F104 rule 3 forbids.
   *
   * Two layers of caching, and they answer different questions:
   *
   * - **30 s TTL**, the same window {@link assertMember}'s project read takes.
   *   Capabilities are configuration, exactly what `features.*` was, so they
   *   get the project row's treatment and not membership's - membership is
   *   revocable and deliberately never cached. `Repository` invalidates the
   *   table on every mutation, so this window only ever applies to a write
   *   made by another isolate, which is the staleness Settings already
   *   discloses for the roadmap.
   * - **The request memo**, so a page that loads seven things at once pays for
   *   this once rather than seven times. It stores the in-flight promise, so
   *   batch entries that start concurrently all await the first one's query
   *   instead of each missing a cache nothing has filled yet.
   *
   * A project with no row at all comes back `{}`, which is a legal state:
   * every capability may be turned off, and a project that has none must still
   * work. That is the test that the modularity is real.
   */
  async capabilitiesOf(projectId: number): Promise<ProjectCapabilitySet> {
    const rows = await this.capabilityRowsOf(projectId);

    const set: ProjectCapabilitySet = {};
    for (const row of rows) {
      // A row this build has no descriptor for is skipped rather than thrown
      // on: a rollback must not make every project unreadable.
      if (!this.registry.find(row.key)) continue;
      set[row.key] = this.registry.optionsOf(row.key, row.options);
    }
    return set;
  }

  /**
   * The rows themselves, for the callers that need `enabledAt` too - the
   * project resource, and the activity feed.
   *
   * This is where the query, the window and the memo actually live;
   * {@link capabilitiesOf} folds these into the shape a gate wants, so the two
   * callers share one read rather than issuing two.
   */
  async capabilityRowsOf(projectId: number): Promise<ProjectCapability[]> {
    return this.memo.resolve(
      `${ProjectSecurityService.CAPABILITY_MEMO_PREFIX}${projectId}`,
      () =>
        this.capabilities.findMany(
          { where: { projectId: { eq: projectId } } },
          { cache: { ttl: ProjectSecurityService.PROJECT_CACHE_TTL_MS } },
        ),
    );
  }

  /**
   * Every listed project's rows, in ONE query.
   *
   * The Home page reads a member's whole project list and the create menu,
   * the sidebar and each card all want the capability set. Reading it per row
   * is N round trips on D1 for a list that already exists in memory - the
   * same shape `AreaService.countByProjectIds` and `openQuests.countByProject`
   * were written to avoid on this exact endpoint.
   *
   * ⚠️ Guarded on the empty list: `inArray: []` throws rather than matching
   * nothing, so a user with no projects would take the whole page down.
   *
   * Deliberately NOT memoized per project id. A list read answers for many
   * ids at once and its own key would be the id set, which no single-project
   * gate can hit; seeding the per-id entries from here would then have to
   * decide what a missing row means, and get it wrong for a project the list
   * was filtered out of.
   */
  async capabilityRowsForProjects(
    projectIds: number[],
  ): Promise<Map<number, ProjectCapability[]>> {
    const byProject = new Map<number, ProjectCapability[]>();
    if (projectIds.length === 0) {
      return byProject;
    }

    const rows = await this.capabilities.findMany(
      { where: { projectId: { inArray: projectIds } } },
      { cache: { ttl: ProjectSecurityService.PROJECT_CACHE_TTL_MS } },
    );

    for (const row of rows) {
      const existing = byProject.get(row.projectId);
      if (existing) {
        existing.push(row);
      } else {
        byProject.set(row.projectId, [row]);
      }
    }
    return byProject;
  }

  /**
   * Whether a capability is on. Absence of a row is disabled — there is no
   * `false` state stored anywhere, so this is a presence test and nothing
   * more.
   */
  hasCapability(set: ProjectCapabilitySet, key: CapabilityKey): boolean {
    return set[key] !== undefined;
  }

  /**
   * Whether an option inside a capability is on.
   *
   * False whenever the capability itself is off, which encodes the one rule
   * this epic has about capabilities reading each other: **a capability may
   * read another's state to narrow what it does, never to widen it.** Sigil
   * feedback is the only instance today, and it needs `apps.track` AND
   * `support` - Support must never silently enable tracking.
   */
  capabilityOption(
    set: ProjectCapabilitySet,
    key: CapabilityKey,
    option: string,
  ): boolean {
    return set[key]?.[option] === true;
  }
}

export interface ProjectGuard {
  project: Project;
  member?: Member;
  /**
   * The project's enabled capabilities, when the gate read them.
   *
   * Optional because {@link ProjectSecurityService.assertMember} does not pay
   * for the read: most endpoints gate on membership and never ask. The gate
   * that does ask fills it, so a handler behind one need not query again.
   */
  capabilities?: ProjectCapabilitySet;
}

/**
 * A project's enabled capabilities, each mapped to its options with defaults
 * filled in.
 *
 * **A key is present if and only if the capability is on.** There is no
 * `false` entry and no `enabled` field, because "no row" and "a row saying no"
 * would be two places for one answer to live.
 */
export type ProjectCapabilitySet = Partial<
  Record<CapabilityKey, Record<string, boolean>>
>;
