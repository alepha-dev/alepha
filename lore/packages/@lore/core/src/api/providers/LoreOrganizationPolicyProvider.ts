import { $inject, Alepha } from "alepha";
import {
  OrganizationPolicyProvider,
  type RankRefusal,
  type RankRows,
  RankService,
} from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import { ForbiddenError } from "alepha/server";

import { projects } from "../entities/projects.ts";
import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import { CapabilityRegistry } from "../schemas/CapabilityRegistry.ts";
import { LoreViewerAllowlist } from "../security/LoreViewerAllowlist.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export class LoreOrganizationPolicyProvider extends OrganizationPolicyProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly projectSecurity = $inject(ProjectSecurityService);
  protected readonly capabilityRegistry = $inject(CapabilityRegistry);
  protected readonly limits = $inject(ProjectLimits);
  protected readonly projects = $repository(projects);

  public override async assertCanCreate(): Promise<void> {
    throw new ForbiddenError("Organizations are created with projects");
  }

  public override async assertCanDelete(): Promise<void> {
    throw new ForbiddenError("Delete the project instead");
  }

  public override async ownedBy(userId: string): Promise<string[]> {
    return this.projectSecurity.ownedOrganizationIds(userId);
  }

  public override async assertRoom(organizationId: string): Promise<void> {
    const max = await this.limits.maxMembersPerProject();
    const count = await this.members.list(organizationId);
    if (count.length >= max) {
      throw new ForbiddenError(
        `This project has reached the maximum number of members allowed (${max}).`,
      );
    }
  }

  public override async refuse(
    refusal: RankRefusal,
    _rows: RankRows,
  ): Promise<string | undefined> {
    const project = await this.projects.findOne({
      where: { organizationId: { eq: refusal.organizationId } },
    });
    if (!project) return undefined;
    const enabled = await this.projectSecurity.capabilitiesOf(project.id);
    const owners = refusal.missing.map((permission) =>
      this.capabilityRegistry.ownerOfPermissionGroup(permission.split(":")[0]),
    );
    if (owners.some((owner) => !owner)) {
      return this.rankRefusal(refusal);
    }
    const disabled = [
      ...new Set(
        owners.filter(
          (owner): owner is CapabilityKey => !!owner && !(owner in enabled),
        ),
      ),
    ];
    if (disabled.length !== 1 || disabled.length !== owners.length) {
      return this.rankRefusal(refusal);
    }
    const capability = this.capabilityRegistry.find(disabled[0]);
    return `This project does not have "${capability?.name ?? disabled[0]}" turned on. An owner can turn it on in Settings.`;
  }

  /**
   * The rank's own refusal. A write refused to a rank that only reads (a
   * viewer of an open project, or any rank made of reads) says so in those
   * words, "read-only in this project", so a person or an agent stops
   * retrying writes rather than asking for one permission at a time.
   *
   * ⚠️ `RankService` is resolved here, not with `$inject`: it reads this
   * provider, so a field would be a cycle.
   */
  protected async rankRefusal(refusal: RankRefusal): Promise<string> {
    const held = refusal.rank
      ? `Your rank (${refusal.rank.name})`
      : "Your rank";
    const writes = refusal.missing.every(
      (permission) => !permission.endsWith(":read"),
    );
    if (refusal.rank && writes) {
      const permissions = await this.alepha
        .inject(RankService)
        .permissionsOf(refusal.organizationId, refusal.rank.key);
      if (permissions && LoreViewerAllowlist.isReadOnly(permissions)) {
        return `You are read-only in this project: ${held.toLowerCase()} grants reads only, not ${refusal.missing.join(", ")}. Ask a project admin to move you to another rank.`;
      }
    }
    return `${held} does not grant ${refusal.missing.join(", ")}. Ask the project owner.`;
  }
}
