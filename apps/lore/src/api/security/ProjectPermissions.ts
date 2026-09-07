import { $inject } from "alepha";
import { RankService } from "alepha/api/ranks";
import { SecurityProvider, type UserAccountToken } from "alepha/security";

import type { Member } from "../entities/members.ts";
import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import { CapabilityRegistry } from "../services/CapabilityRegistry.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { ProjectRankResource } from "./ProjectRankResource.ts";

/**
 * The caller's **effective** permission set inside one project, computed once,
 * server-side.
 *
 * ## Why the final answer and not the raw material
 *
 * Effective access is `application permission AND rank AND capability`. The
 * client could be sent the three pieces and asked to intersect them, and that
 * is precisely what must not happen: two implementations of one rule, on two
 * sides of a wire, is how a sidebar and an endpoint come to disagree about who
 * may do something - and the disagreement is invisible until somebody with an
 * unusual rank complains that a button does nothing.
 *
 * So the client receives a flat list of about thirty short strings, its own,
 * and its only operation is `includes`.
 *
 * ## It costs no query on the paths that use it
 *
 * The membership row is the one the gate read, passed in rather than fetched.
 * The rank definitions and the capability rows are both memoised per request
 * and cached for thirty seconds, and the handlers that call this have already
 * read both.
 */
export class ProjectPermissions {
  protected readonly security = $inject(SecurityProvider);
  protected readonly projectSecurity = $inject(ProjectSecurityService);
  protected readonly capabilities = $inject(CapabilityRegistry);
  protected readonly ranks = $inject(RankService);

  /**
   * What this caller may do in this project, as `group:name` strings.
   *
   * `member` is the row the gate read: `undefined` means the caller holds no
   * membership, which only happens for a privileged identity, since every
   * other path is gated on having one.
   */
  public async of(
    projectId: number,
    user: UserAccountToken,
    member: Member | undefined,
  ): Promise<ProjectPermissionSet> {
    const registered = this.security
      .getPermissions()
      .filter((it) => it.group && it.name)
      .map((it) => `${it.group}:${it.name}`)
      .filter((it) => !it.startsWith("admin:"));

    // A privileged identity is not narrowed by a rank, matching `$owns`'s own
    // `ownership === false` bypass. Nor by a capability: an operator looking at
    // a project with Work off is not being offered a quest button, because
    // there is no page to put one on.
    if (user.ownership === false) {
      return { permissions: registered };
    }

    // 1. Application scope: what the caller's roles grant, whatever project
    // they are in. For an ordinary Lore user this is everything but `admin:*`.
    const app = new Set(
      this.security
        .getPermissions(user)
        .filter((it) => it.group && it.name)
        .map((it) => `${it.group}:${it.name}`),
    );

    // 2. The rank, from the membership row the gate already read.
    const key = member?.rank ?? ProjectRankResource.DEFAULT_KEY;
    const rank = member
      ? (await this.ranks.ranksOf("project", String(projectId))).find(
          (it) => it.key === key,
        )
      : undefined;
    const granted =
      (await this.ranks.permissionsOf("project", String(projectId), key)) ?? [];

    // 3. The capabilities that are on. A permission whose group belongs to a
    // capability the project does not have is not offerable, whatever any rank
    // says - and the matrix hides those rows for the same reason.
    const enabled = Object.keys(
      await this.projectSecurity.capabilitiesOf(projectId),
    ) as CapabilityKey[];

    const permissions = registered.filter((permission) => {
      if (!app.has(permission)) {
        return false;
      }
      if (!this.ranks.grants(granted, permission)) {
        return false;
      }
      const owner = this.capabilities.ownerOfPermissionGroup(
        permission.split(":")[0],
      );
      return this.capabilities.isOwnerEnabled(owner, enabled);
    });

    return {
      permissions,
      ...(rank ? { rank: { key: rank.key, name: rank.name } } : {}),
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface ProjectPermissionSet {
  permissions: string[];
  /**
   * Which rank produced them, for the surfaces that name it rather than gate
   * on it. Absent for a privileged identity, which holds no rank.
   */
  rank?: { key: string; name: string };
}
