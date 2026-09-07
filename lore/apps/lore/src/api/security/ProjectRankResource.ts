import { $inject } from "alepha";
import { $rankResource, RankService } from "alepha/api/ranks";
import { $repository } from "alepha/orm";
import { ResourceGateMemoProvider } from "alepha/security";
import { BadRequestError, ForbiddenError } from "alepha/server";

import { members } from "../entities/members.ts";
import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import { CapabilityRegistry } from "../services/CapabilityRegistry.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { LorePermissions } from "./LorePermissions.ts";

/**
 * Everything `alepha/api/ranks` does not know about a Lore project.
 *
 * The module carries what a rank IS: the definitions table, the resolver, the
 * two caches, the invariants, the HTTP surface. The answers below are the ones
 * that need to know what a project is, and they are the only place in Lore
 * where ranks and projects meet. Shaped after `ProjectInvitationResource`,
 * which is the same arrangement for `alepha/api/invitations`.
 *
 * ## The scope, and the assignment
 *
 * The scope is the project id, stringified: the module never parses an id
 * whose shape it cannot know. (Alepha Club's is a constant instead - one
 * instance, one club - which is the whole reason the module takes a closure
 * and not a column.)
 *
 * The assignment is `members.rank`, read off **the membership row `$owns` has
 * already loaded and memoized**. `rank()` is synchronous, so there is nowhere
 * to put a query even by accident, and a project member's permission set
 * therefore costs zero extra reads per request.
 *
 * ## Two built-ins, and two lists
 *
 * `owner` grants `*` and is not configurable: exactly one per project, and
 * ⚠️ **never an assignment target** - the only path to it is the ownership
 * transfer, because a rank you can be given is not ownership. `member` is the
 * default every NULL `rank` column reads as, and its set is
 * `LorePermissions.MEMBER_DEFAULT` - the epic's acceptance criterion, which is
 * why it lives there beside the permissions rather than here.
 *
 * The **ceiling** (`project:delete`, `capability:manage`) and the **floor**
 * (`project:read`) are lists rather than special-cased strings, so a third
 * ceiling or a second floor later is data. The module enforces both on its
 * write path; the matrix renders both non-editable. The editor is a
 * convenience and the module is the rule.
 */
export class ProjectRankResource {
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly capabilityRegistry = $inject(CapabilityRegistry);
  protected readonly ranks = $inject(RankService);
  protected readonly members = $repository(members);
  protected readonly memo = $inject(ResourceGateMemoProvider);

  /**
   * The rank a NULL `members.rank` column reads as.
   *
   * A project created before this epic, that has never opened the matrix,
   * stores zero definition rows and every one of its members lands here - so
   * it behaves exactly as it did before.
   */
  public static readonly DEFAULT_KEY = "member";

  public static readonly OWNER_KEY = "owner";

  public readonly project = $rankResource({
    type: "project",

    /**
     * The row `$ownsProject` decided against is always the project, on the
     * direct branch and on every hop, so this recognises it by the shape of a
     * project row rather than by a param that may name a quest.
     */
    scope: ({ authority }) =>
      typeof authority?.id === "number" && "createdBy" in authority
        ? String(authority.id)
        : undefined,

    /**
     * ⚠️ Synchronous, and a column read. See the note above: this is the whole
     * performance contract of the epic.
     */
    rank: ({ membership }) =>
      (membership?.rank as string | undefined) ??
      (membership ? ProjectRankResource.DEFAULT_KEY : undefined),

    builtins: [
      {
        key: ProjectRankResource.OWNER_KEY,
        name: "Owner",
        // `*` rather than the enumerated set, deliberately: an owner listed
        // permission by permission falls behind every time a new one is
        // declared, silently, and the failure is an owner who cannot do
        // something in their own project.
        permissions: ["*"],
      },
      {
        key: ProjectRankResource.DEFAULT_KEY,
        name: "Member",
        permissions: LorePermissions.MEMBER_DEFAULT,
      },
    ],

    ownerOnly: LorePermissions.OWNER_ONLY,
    floor: LorePermissions.FLOOR,
    manage: "rank:manage",

    assertCanManage: async (scopeId, user) => {
      await this.assertHolds(scopeId, user, "rank:manage");
    },

    assertCanAssign: async (scopeId, user) => {
      await this.assertHolds(scopeId, user, "member:manage");
    },

    assign: async (scopeId, userId, rankKey) => {
      if (rankKey === ProjectRankResource.OWNER_KEY) {
        // ⚠️ The one rank that is not assignable. Ownership is transferred,
        // which is a different act with a different confirmation and a
        // different consequence for the giver - and a project with two owners
        // is a state nothing else in this app can express.
        throw new BadRequestError(
          "Ownership is transferred, not assigned. Use the transfer action.",
        );
      }

      const row = await this.members.findOne({
        where: {
          projectId: { eq: Number(scopeId) },
          userId: { eq: userId },
        },
      });

      if (!row) {
        throw new BadRequestError(
          "That person is not a member of this project",
        );
      }

      if (row.rank === ProjectRankResource.OWNER_KEY) {
        throw new BadRequestError(
          "The project owner's rank cannot be changed. Transfer ownership first.",
        );
      }

      await this.members.updateById(row.id, { rank: rankKey });
    },

    countHolders: async (scopeId, rankKey) =>
      await this.members.count({
        projectId: { eq: Number(scopeId) },
        rank: { eq: rankKey },
      }),

    /**
     * For the imperative check only: the call sites that hold ids and no rows
     * (a file route deciding per bucket, a closure handed to another module,
     * a resolver keyed on a slug). The middleware path never reaches this.
     *
     * ⚠️ Through the gate's own memo, under the key `$owns` would use. The
     * MCP resolver checks `project:read` imperatively and the action's
     * `$ownsProject` then gates the same request, so without the shared key
     * every MCP tool call reads the membership row twice - and an MCP call is
     * one operation per HTTP request, with no sibling to amortize it against.
     * `test/mcp-tool-query-count.spec.ts` is what holds this.
     */
    load: async (scopeId, user) =>
      await this.memo.resolve(
        ResourceGateMemoProvider.membershipKey({
          table: this.members.tableName,
          resourceColumn: "projectId",
          resourceId: Number(scopeId),
          userColumn: "userId",
          userId: user.id,
        }),
        () =>
          this.members.findOne({
            where: {
              projectId: { eq: Number(scopeId) },
              userId: { eq: user.id },
            },
          }),
      ),

    /**
     * ⚠️ Name the conjunct that actually failed.
     *
     * Effective access is `application permission AND rank AND capability`.
     * Presets are computed from the ENABLED capability set, so on a project
     * with Work off no rank carries `quest:create` - and a member told "your
     * rank does not grant quest:create" would ask the owner for a better rank,
     * the owner would open the matrix, and there would be no `quest:create`
     * row there at all, because the matrix hides a disabled capability's rows.
     * A closed loop with no exit.
     *
     * Returning `undefined` accepts the module's own wording, which is the
     * right answer when the rank really is the reason.
     */
    refuse: async ({ scopeId, missing }) => {
      const off = await this.disabledCapabilitiesOf(scopeId, missing);

      // Only when EVERY missing permission is explained by a capability being
      // off. A member missing one permission because of a switch and another
      // because of their rank is told about the rank, which is the answer they
      // can act on.
      if (off.length !== 1) {
        return undefined;
      }

      const capability = this.capabilityRegistry.find(off[0]);
      return `This project does not have "${capability?.name ?? off[0]}" turned on. An owner can turn it on in Settings.`;
    },
  });

  /**
   * The capabilities that would have to be ON for these permissions to be
   * grantable at all, and that are not.
   *
   * Reads through {@link ProjectSecurityService.capabilitiesOf}, which is
   * cached for 30 s and memoized per request - so on the path that produces
   * this message the rows are already in hand and this costs nothing.
   *
   * An empty answer means the rank really is the reason.
   */
  protected async disabledCapabilitiesOf(
    scopeId: string,
    missing: string[],
  ): Promise<CapabilityKey[]> {
    const enabled = await this.security.capabilitiesOf(Number(scopeId));

    const owners = missing.map((permission) =>
      this.capabilityRegistry.ownerOfPermissionGroup(permission.split(":")[0]),
    );

    // A Core permission (no owning capability) is never explained by a
    // switch, so one of those in the list settles it: the rank is the reason.
    if (owners.some((it) => !it)) {
      return [];
    }

    const off = [
      ...new Set(
        owners.filter((it): it is CapabilityKey => !!it && !(it in enabled)),
      ),
    ];

    return off.length === owners.length ? off : [];
  }

  /**
   * The manage closures, answering through the module's own imperative check.
   *
   * Both permissions are grantable under the subset rule, so this is a real
   * question about the caller's rank rather than an owner check: an Admin
   * holding `rank:manage` may edit ranks, and the module then re-checks on
   * every write that the set being written is inside the editor's own.
   */
  protected async assertHolds(
    scopeId: string,
    user: { id: string; ownership?: string | boolean },
    permission: string,
  ): Promise<void> {
    if (user.ownership === false) {
      return;
    }

    const row = await this.members.findOne({
      where: {
        projectId: { eq: Number(scopeId) },
        userId: { eq: user.id },
      },
    });

    if (row?.rank === ProjectRankResource.OWNER_KEY) {
      return;
    }

    // Resolved through the module, which is not a cycle: this closure is
    // called by the module's WRITE path, and `permissionsOf` is a read that
    // calls nothing back. The membership row above is the one the gate read,
    // through the same repository, so the ORM's cache answers it.
    const held = row
      ? ((await this.ranks.permissionsOf(
          "project",
          scopeId,
          row.rank ?? ProjectRankResource.DEFAULT_KEY,
        )) ?? [])
      : [];

    if (!this.ranks.grants(held, permission)) {
      throw new ForbiddenError(
        `Your rank does not grant ${permission}. Ask the project owner.`,
      );
    }
  }
}
