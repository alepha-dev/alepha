import { $inject } from "alepha";
import {
  $invitationResource,
  type InvitationDescription,
  type InvitationEntity,
} from "alepha/api/invitations";
import { RankService } from "alepha/api/ranks";
import { type UserEntity, users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ForbiddenError } from "alepha/server";

import { members } from "../entities/members.ts";
import { projects } from "../entities/projects.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";

/**
 * Everything `alepha/api/invitations` does not know about a Lore project.
 *
 * The module carries the invitation itself: the address, the status machine,
 * the expiry, the caps, the sweeps, the admin surface. The six answers below
 * are the ones that need to know what a project is, and they are the only
 * place in Lore where invitations and projects meet.
 *
 * `resourceId` arrives as a string because the module stores it as one. Every
 * `Number(...)` here is the seam doing its job: the module never parses an id
 * whose shape it cannot know.
 */
export class ProjectInvitationResource {
  protected readonly ranks = $inject(RankService);
  protected readonly limits = $inject(ProjectLimits);
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(members);
  protected readonly users = $repository(users);

  public readonly project = $invitationResource({
    type: "project",

    // Inviting is `member:manage` now rather than "owns the project", so an
    // Admin rank can do it. `resourceId` is passed through as the string the
    // module stores: the scope of a Lore rank is the project id as text.
    // ⚠️ ranks: imperative. This is a closure handed to
    // `alepha/api/invitations`, not an action's `use:` entry, so there is no
    // middleware chain to put a gate in. It moves to the ranks module's
    // imperative check, never to `$ownsProject`.
    assertCanInvite: async (resourceId, inviter) => {
      await this.ranks.assert("project", resourceId, "member:manage", inviter);
    },

    assertRoom: (resourceId) => this.assertRoomForOneMore(resourceId),

    isPrincipal: async (resourceId, principal) => {
      // At create time there is only an address, and it may belong to nobody
      // yet. Resolving it is Lore's job: membership is keyed on a user id,
      // and the module holds no users table on purpose.
      const userId =
        principal.userId ??
        (
          await this.users.findOne({
            where: { email: { eq: principal.email } },
          })
        )?.id;
      if (!userId) {
        return false;
      }
      const member = await this.members.findOne({
        where: {
          projectId: { eq: Number(resourceId) },
          userId: { eq: userId },
        },
      });
      return !!member;
    },

    // ⚠️ `invitation.roles[0]` is the RANK the invitee lands on, validated
    // when the invitation was written (`InvitationController.createInvitation`)
    // rather than here: the subset rule has to hold against the person who
    // offered the rank, not against whoever is around when it is accepted.
    //
    // It falls back to `member` when the field is absent - every invitation
    // sent before this shipped - and also when the rank has been DELETED since,
    // which is a real state: the matrix refuses to delete a held rank, and an
    // unanswered invitation holds nothing.
    grant: async (userId, invitation) => {
      const named = invitation.roles?.[0];
      const exists =
        named &&
        (await this.ranks.ranksOf("project", invitation.resourceId)).some(
          (it) => it.key === named,
        );

      await this.members.create({
        projectId: Number(invitation.resourceId),
        userId,
        owner: false,
        rank: exists ? named : "member",
      });
    },

    describe: (invitations) => this.describeAll(invitations),
  });

  /**
   * Two queries for the whole inbox rather than two per invitation, and the
   * two per invitation were SEQUENTIAL: five pending invitations cost ten D1
   * round trips.
   *
   * The inviter ids are what the dedupe is really for: one person inviting
   * someone to six projects is six rows and one user. Two rows cannot name
   * the same project here, since `create` refuses a second pending
   * invitation for the same `(resource, email)` and this list is one email,
   * so the `new Set` on those is defence rather than a saving.
   */
  protected async describeAll(
    invitations: InvitationEntity[],
  ): Promise<Array<InvitationDescription | undefined>> {
    const projectIds = [
      ...new Set(
        invitations
          .map((inv) => Number(inv.resourceId))
          .filter((id) => Number.isFinite(id)),
      ),
    ];
    const inviterIds = [
      ...new Set(invitations.map((inv) => inv.invitedBy).filter(Boolean)),
    ];

    // `inArray: []` throws, and neither list follows from a non-empty input:
    // `resourceId` is a string column and `invitedBy` an optional one, so
    // either can filter down to nothing while rows remain.
    const [projects, inviters] = await Promise.all([
      projectIds.length
        ? this.projects.findMany({
            where: { id: { inArray: projectIds } },
            columns: ["id", "title"],
          })
        : [],
      inviterIds.length
        ? this.users.findMany({ where: { id: { inArray: inviterIds } } })
        : [],
    ]);

    const projectById = new Map(projects.map((it) => [it.id, it]));
    const inviterById = new Map(inviters.map((it) => [it.id, it]));

    // A missing row keeps the behaviour a per-row `findOne` gave it: an
    // absent title (the controller supplies the "Project" fallback) and
    // `formatInviterName`'s own undefined handling.
    return invitations.map((inv) => ({
      resourceTitle: projectById.get(Number(inv.resourceId))?.title,
      inviterName: this.formatInviterName(inviterById.get(inv.invitedBy)),
    }));
  }

  /**
   * Refuse when the project already holds every member it is allowed.
   *
   * Called on both sides of an invitation by the module: at create so the
   * owner is told before anyone is emailed, and at accept because that is
   * where the member row is actually written and where two invitations
   * racing for the last seat have to be separated.
   */
  protected async assertRoomForOneMore(resourceId: string): Promise<void> {
    const maxMembersPerProject = await this.limits.maxMembersPerProject();
    const memberCount = await this.members.count({
      projectId: { eq: Number(resourceId) },
    });
    if (memberCount >= maxMembersPerProject) {
      throw new ForbiddenError(
        `This project has reached the maximum number of members allowed (${maxMembersPerProject}).`,
      );
    }
  }

  protected formatInviterName(user?: UserEntity): string | undefined {
    if (!user?.email) {
      return undefined;
    }
    const at = user.email.indexOf("@");
    return at > 0 ? user.email.slice(0, at) : user.email;
  }
}
