import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";

import { organizationMembers } from "../entities/organizationMembers.ts";
import { type Organization, organizations } from "../entities/organizations.ts";
import { OrganizationPolicyProvider } from "../providers/OrganizationPolicyProvider.ts";
import type { OrganizationSummaryResource } from "../schemas/organizationSummaryResourceSchema.ts";
import { MemberService } from "./MemberService.ts";

export class OrganizationService {
  protected readonly organizations = $repository(organizations);
  protected readonly members = $repository(organizationMembers);
  protected readonly memberService = $inject(MemberService);
  protected readonly policy = $inject(OrganizationPolicyProvider);

  public async create(
    input: Pick<Organization, "name"> &
      Partial<Pick<Organization, "slug" | "logo" | "metadata">>,
    user: Pick<UserAccountToken, "id">,
  ): Promise<Organization> {
    await this.policy.assertCanCreate(user as UserAccountToken);
    const organization = await this.organizations.create(input);
    try {
      await this.memberService.addOwner(organization.id, user.id);
    } catch (error) {
      await this.organizations.deleteById(organization.id);
      throw error;
    }
    return organization;
  }

  public get(id: string): Promise<Organization> {
    return this.organizations.getById(id);
  }

  public update(
    id: string,
    input: Partial<Pick<Organization, "name" | "slug" | "logo" | "metadata">>,
  ): Promise<Organization> {
    return this.organizations.updateById(id, input);
  }

  public async delete(id: string, user: UserAccountToken): Promise<void> {
    const organization = await this.get(id);
    await this.policy.assertCanDelete(organization, user);
    await this.organizations.deleteById(id);
  }

  public async listMine(
    userId: string,
  ): Promise<OrganizationSummaryResource[]> {
    const memberships = await this.members.findMany({
      where: { userId: { eq: userId } },
    });
    if (memberships.length === 0) return [];
    const rows = await this.organizations.findMany({
      where: { id: { inArray: memberships.map((row) => row.organizationId) } },
      orderBy: { column: "createdAt", direction: "asc" },
    });
    const rankByOrganization = new Map(
      memberships.map((row) => [
        row.organizationId,
        row.rank ?? MemberService.MEMBER,
      ]),
    );
    return rows.map((organization) => ({
      ...organization,
      rank: rankByOrganization.get(organization.id) ?? MemberService.MEMBER,
    }));
  }
}
