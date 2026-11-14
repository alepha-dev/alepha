import { projects } from "@lore/core/schemas";
import { $hook, $inject } from "alepha";
import { $repository } from "alepha/orm";

import { hosts } from "../entities/hosts.ts";
import { HostService } from "./HostService.ts";

/**
 * Keeps a homed host's `ownerUserId` on its home project's owner (#Q3278).
 *
 * `ownerUserId` is the cascade anchor, not an owner (see `hosts`): it
 * cannot be dropped, so it must point at somebody whose account cannot go
 * while the host has a home. The owner of a live project cannot delete
 * their account (`LoreOrganizationPolicyProvider.ownedBy`), so that is the
 * one person it may name.
 *
 * Two paths, and the second is the guard: an ownership transfer repoints the
 * project's hosts to the new owner at once, and before any account is
 * deleted every homed host still anchored on it is repointed to its home
 * project's owner, so a transfer whose repoint failed halfway still cannot
 * take a host with the previous owner's account. Each only ever writes
 * the value the anchor should already hold, so it is harmless when another
 * handler then refuses the deletion.
 *
 * A host with no home keeps its anchor and still goes with that account,
 * until the instance admin assigns it.
 */
export class HostAnchorHooks {
  protected readonly hosts = $repository(hosts);
  protected readonly projects = $repository(projects);
  protected readonly service = $inject(HostService);

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
   * Repoint the hosts homed in an organization's project to its new owner.
   */
  public async repointTo(
    organizationId: string,
    toUserId: string,
  ): Promise<void> {
    const project = await this.projects.findOne({
      where: { organizationId: { eq: organizationId } },
    });
    if (!project) return;
    await this.hosts.updateMany(
      { projectId: { eq: project.id } },
      { ownerUserId: toUserId },
      { touch: false },
    );
  }

  /**
   * Repoint every homed host anchored on `userId` to its home project's
   * owner. A project the leaving user still owns is left alone: the
   * organization policy refuses that deletion.
   */
  public async repointAway(userId: string): Promise<void> {
    const anchored = await this.hosts.findMany({
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
      const owner = await this.service.ownerOf(projectId);
      if (!owner || owner === userId) continue;
      await this.hosts.updateMany(
        { ownerUserId: { eq: userId }, projectId: { eq: projectId } },
        { ownerUserId: owner },
        { touch: false },
      );
    }
  }
}
