import { $inject } from "alepha";
import { type OrganizationMember, RankService } from "alepha/api/organizations";
import {
  EffectivePermissionsProvider,
  type UserAccountToken,
} from "alepha/security";

import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import { CapabilityRegistry } from "../services/CapabilityRegistry.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

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
 *
 * ## What moved upstream
 *
 * The application half - the catalogue, the role grant, the `ownership` bypass
 * and the permission scope - is `EffectivePermissionsProvider`, because Club
 * needs exactly that and a second implementation of one rule is the thing this
 * class exists to argue against. What stays here is what is Lore's: the rank
 * and the capability, expressed as two narrowing factors.
 */
export class ProjectPermissions {
  protected readonly effective = $inject(EffectivePermissionsProvider);
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
    member: OrganizationMember | undefined,
  ): Promise<ProjectPermissionSet> {
    /**
     * A privileged identity is narrowed by neither factor, so reading the
     * ranks and the capabilities for one would be two queries spent on an
     * answer that ignores them. The bypass itself lives upstream; this is
     * only about not paying for it.
     */
    if (user.ownership === false) {
      return {
        permissions: this.effective.resolve({ user, exclude: ["admin:"] }),
      };
    }

    // 1. The rank, from the membership row the gate already read.
    const key = member?.rank ?? "member";
    const organizationId =
      await this.projectSecurity.organizationIdOf(projectId);
    const rank = member
      ? (await this.ranks.ranksOf(organizationId)).find((it) => it.key === key)
      : undefined;
    const granted = (await this.ranks.permissionsOf(organizationId, key)) ?? [];

    // 2. The capabilities that are on. A permission whose group belongs to a
    // capability the project does not have is not offerable, whatever any rank
    // says - and the matrix hides those rows for the same reason.
    const enabled = Object.keys(
      await this.projectSecurity.capabilitiesOf(projectId),
    ) as CapabilityKey[];

    // The application half - catalogue, role grant, permission scope - is
    // upstream; what stays here is the two factors that are Lore's.
    const permissions = this.effective.resolve({
      user,
      exclude: ["admin:"],
      narrow: [
        (permission) => this.ranks.grants(granted, permission),
        (permission) =>
          this.capabilities.isOwnerEnabled(
            this.capabilities.ownerOfPermissionGroup(permission.split(":")[0]),
            enabled,
          ),
      ],
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
