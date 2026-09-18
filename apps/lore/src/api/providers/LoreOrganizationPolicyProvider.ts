import { $inject } from "alepha";
import {
  OrganizationPolicyProvider,
  type RankRefusal,
  type RankRows,
} from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import { ForbiddenError } from "alepha/server";

import { projects } from "../entities/projects.ts";
import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import { CapabilityRegistry } from "../services/CapabilityRegistry.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export class LoreOrganizationPolicyProvider extends OrganizationPolicyProvider {
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

  protected rankRefusal(refusal: RankRefusal): string {
    const held = refusal.rank
      ? `Your rank (${refusal.rank.name})`
      : "Your rank";
    return `${held} does not grant ${refusal.missing.join(", ")}. Ask the project owner.`;
  }
}
