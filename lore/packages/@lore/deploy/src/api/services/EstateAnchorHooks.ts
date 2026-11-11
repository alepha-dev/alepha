import { projects } from "@lore/core/schemas";
import { $hook } from "alepha";
import { organizationMembers } from "alepha/api/organizations";
import { $repository } from "alepha/orm";

import { estates } from "../entities/estates.ts";

/**
 * Keeps a homed estate's `ownerUserId` on its home project's owner (#Q3278).
 *
 * `ownerUserId` is the cascade anchor, not an owner (see `estates`): it
 * cannot be dropped, so it must point at somebody whose account cannot go
 * while the estate has a home. The owner of a live project cannot delete
 * their account (`LoreOrganizationPolicyProvider.ownedBy`), so that is the
 * one person it may name.
 *
 * Two paths, and the second is the guard: an ownership transfer repoints the
 * project's estates to the new owner at once, and before any account is
 * deleted every homed estate still anchored on it is repointed to its home
 * project's owner, so a transfer whose repoint failed halfway still cannot
 * take an estate with the previous owner's account. Each only ever writes
 * the value the anchor should already hold, so it is harmless when another
 * handler then refuses the deletion.
 *
 * An estate with no home keeps its anchor and still goes with that account,
 * until the instance admin assigns it.
 */
export class EstateAnchorHooks {
  protected readonly estates = $repository(estates);
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(organizationMembers);

  protected readonly onOwnershipTransferred = $hook({
    on: "organization:ownership:transferred",
    handler: async ({ organizationId, toUserId }) => {
      await this.repointTo(organizationId, toUserId);
    },
  });

  protected readonly onUserDelete = $hook({
    on: "user:delete:before",
    handler: async ({ userId }) => {
      await this.repointAway(userId);
    },
  });

  /**
   * Repoint the estates homed in an organization's project to its new owner.
   */
  public async repointTo(
    organizationId: string,
    toUserId: string,
  ): Promise<void> {
    const project = await this.projects.findOne({
      where: { organizationId: { eq: organizationId } },
    });
    if (!project) return;
    await this.estates.updateMany(
      { projectId: { eq: project.id } },
      { ownerUserId: toUserId },
      { touch: false },
    );
  }

  /**
   * Repoint every homed estate anchored on `userId` to its home project's
   * owner. A project the leaving user still owns is left alone: the
   * organization policy refuses that deletion.
   */
  public async repointAway(userId: string): Promise<void> {
    const anchored = await this.estates.findMany({
      where: {
        ownerUserId: { eq: userId },
        projectId: { isNotNull: true },
      },
      columns: ["projectId"],
    });
    const projectIds = [
      ...new Set(anchored.map((row) => row.projectId as number)),
    ];
    for (const projectId of projectIds) {
      const owner = await this.ownerOf(projectId);
      if (!owner || owner === userId) continue;
      await this.estates.updateMany(
        { ownerUserId: { eq: userId }, projectId: { eq: projectId } },
        { ownerUserId: owner },
        { touch: false },
      );
    }
  }

  /**
   * The user id of a project's owner, or undefined for a project with none.
   */
  public async ownerOf(projectId: number): Promise<string | undefined> {
    const project = await this.projects.findById(projectId);
    if (!project?.organizationId) return undefined;
    const owner = await this.members.findOne({
      where: {
        organizationId: { eq: project.organizationId },
        rank: { eq: "owner" },
      },
    });
    return owner?.userId;
  }
}
