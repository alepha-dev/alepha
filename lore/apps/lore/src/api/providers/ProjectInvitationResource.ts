import { $inject } from "alepha";
import {
  $invitationResource,
  type InvitationDescription,
  type InvitationEntity,
} from "alepha/api/invitations";
import { type UserEntity, users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ForbiddenError } from "alepha/server";

import { members } from "../entities/members.ts";
import { projects } from "../entities/projects.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

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
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly limits = $inject(ProjectLimits);
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(members);
  protected readonly users = $repository(users);

  public readonly project = $invitationResource({
    type: "project",

    // Owning the project is the whole gate, exactly as it was before the
    // extraction: `InvitationService.create` called `assertOwner` directly.
    assertCanInvite: async (resourceId, inviter) => {
      // `assertOwner` returns the rows it read; the seam wants only the
      // refusal, so the return value is dropped here rather than widened
      // into the module's signature.
      await this.security.assertOwner(Number(resourceId), inviter);
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

    // Every accept has always written `owner: false`; `invitation.roles` is
    // carried by the module and read by nobody. See the note on
    // `ProjectInvitationResource` in the module's own docs.
    grant: async (userId, invitation) => {
      await this.members.create({
        projectId: Number(invitation.resourceId),
        userId,
        owner: false,
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
