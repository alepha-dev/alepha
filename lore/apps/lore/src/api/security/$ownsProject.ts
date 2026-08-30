import { $context, type Middleware } from "alepha";
import type { Repository } from "alepha/orm";
import { $owns, type OwnsHop, type OwnsOptions } from "alepha/security";

import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * Lore's project gate: the one authorization rule this application has,
 * stated once.
 *
 * Every project-scoped endpoint asks the same question - is the caller the
 * project's creator, or a member of it - and answers it in one of two shapes:
 * the route names the project, or the route names a row that belongs to one.
 * `$owns` can express both, but only by repeating a six-line options object
 * at each of the sixty-odd call sites, which is how the rule itself would
 * come to be stated sixty times.
 *
 * `owner: "createdBy"`, the `via` join onto `members`, both denial messages
 * and the cache window are constants of this application rather than of these
 * endpoints, so they live here. A call site states only what varies:
 *
 * ```typescript
 * $ownsProject({ param: "projectId" })                          // the param names the project
 * $ownsProject({ repository: () => this.epics, param: "id" })   // the param names a row that has one
 * $ownsProject({ repository: () => this.releases, param: "id", owner: true })
 * $ownsProject({ param: "projectId", from: "query" })
 * ```
 *
 * ## Why this is a const and not a method on a class
 *
 * `apps/lore/CLAUDE.md` says never to write code outside a class, so that
 * everything stays substitutable through DI. This is the documented
 * exception, for a concrete reason rather than convenience: an in-class
 * `ProjectGates.member(...)` would be reached as
 * `use: [this.gates.member(...)]`, which forces `gates = $inject(...)` to be
 * declared **above every action in the file**. That is precisely the
 * field-ordering trap `$owns`'s repository thunk exists to avoid. A
 * module-level const carries no ordering constraint.
 *
 * ## ⚠️ On a `$transactional()` action, the gate goes AFTER it
 *
 * ```typescript
 * use: [$secure({ permissions: ["quest:update"] }), $transactional(), this.ownsQuest()]
 * ```
 *
 * The gate is an access check, but on a hop it is also the READ HALF of the
 * handler's check-then-write: the row it loads is the row the handler then
 * inspects and updates. Those reads used to be the first statements of the
 * handler, inside the transaction. `QuestController.completeQuest` is
 * transactional "so two concurrent completions cannot both pass the
 * `completedAt IS NULL` read", and `updateQuestById` for the same reason on
 * `expectedUpdatedAt`.
 *
 * Putting the gate ahead of `$transactional()` lifts those reads out of the
 * transaction and reinstates both races - with every test still green,
 * because a race is not what a test suite is looking at. The cost of the
 * correct order is that a refused caller opens a transaction and rolls it
 * back, which is nothing next to what the other order gives up.
 *
 * ## Framework, or here
 *
 * The hop, the source selector and the request memo are generic and live in
 * `$owns`. The convention that a foreign key called `projectId` points at a
 * `projects` table whose creator column is `createdBy` is Lore's, and the
 * framework must not guess it. A second Alepha app writes its own version of
 * this file.
 */
export const $ownsProject = (options: OwnsProjectOptions): Middleware => {
  const { alepha } = $context();
  const security = alepha.inject(ProjectSecurityService);

  return $owns({
    param: options.param,
    from: options.from,
    secure: options.secure,

    // The same window `assertMember` used, kept so the port is not a latency
    // regression: that call read the project row through the ORM's keyed
    // cache, and `$owns` on its own does not.
    cache: options.cache ?? {
      ttl: ProjectSecurityService.PROJECT_CACHE_TTL_MS,
    },

    repository: options.repository ?? (() => security.projects),

    ...(options.repository
      ? {
          through: [
            // Whatever the caller has to walk through first, then the last
            // link onto `projects` - which is the one constant here.
            ...(options.hops ?? []),
            {
              column: options.column ?? "projectId",
              repository: () => security.projects,
            },
          ],
        }
      : {
          // Only on the direct branch. Here the id is always a project's, and
          // `projects.id` is an integer, while a path segment is text. On the
          // hop branch the id belongs to the resource and may well be a uuid
          // (folios, directories, blobs), where `Number` would produce NaN.
          cast: Number,
        }),

    owner: "createdBy",

    ...(options.owner
      ? {}
      : {
          via: {
            repository: () => security.members,
            resource: "projectId",
            user: "userId",
          },
        }),

    // Same wording the service used, and deliberately the same message on
    // both branches of each variant: a different message per branch tells a
    // caller whether the resource exists and who owns it.
    message: options.owner
      ? "Only the project owner can perform this action"
      : "Not a member of this project",
  });
};

// ---------------------------------------------------------------------------------------------------------------------

export interface OwnsProjectOptions extends Pick<
  OwnsOptions,
  "param" | "from" | "cache" | "secure"
> {
  /**
   * Repository the route param's row is loaded from, when the param names
   * something other than the project itself - a quest, a folio, an epic.
   *
   * Omit it when the param names the project. A thunk for the same reason
   * `$owns` takes one: this is evaluated during class-field initialization,
   * where a `$repository()` declared further down the class does not exist
   * yet.
   */
  repository?: () => Repository<any>;

  /**
   * Rows to walk through before reaching one that carries the project id.
   *
   * Almost never needed: a Lore entity carries `projectId` itself. Quest
   * comments are the exception - a comment references a quest, and only the
   * quest references the project, so gating one by its own id takes two hops:
   *
   * ```typescript
   * $ownsProject({
   *   repository: () => this.comments,
   *   param: "id",
   *   hops: [{ column: "questId", repository: () => this.quests }],
   * })
   * ```
   *
   * The final link onto `projects` is appended for you, so this lists only
   * what comes before it.
   *
   * Ignored without {@link OwnsProjectOptions.repository}.
   */
  hops?: OwnsHop[];

  /**
   * Column holding the project id, on the last row the walk reaches.
   * Defaults to `projectId`, which is what every Lore entity calls it.
   *
   * Ignored without {@link OwnsProjectOptions.repository}.
   */
  column?: string;

  /**
   * Restrict to the project's creator rather than any member.
   *
   * For project *configuration* - releases, areas, sigils, invitations,
   * settings. The work itself (quests, folios, epics and their satellites) is
   * member-gated. Which side an endpoint belongs on is the rule written up in
   * `apps/lore/CLAUDE.md`, not a matter of copying whichever neighbouring
   * endpoint was read first.
   */
  owner?: boolean;
}
