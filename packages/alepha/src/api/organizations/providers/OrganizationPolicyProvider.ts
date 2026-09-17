import { $inject } from "alepha";
import type { UserAccountToken } from "alepha/security";

import type { Organization } from "../entities/organizations.ts";
import { MemberService } from "../services/MemberService.ts";

export class OrganizationPolicyProvider {
  protected readonly members = $inject(MemberService);

  public async assertCanCreate(_user: UserAccountToken): Promise<void> {}

  public async assertCanDelete(
    _organization: Organization,
    _user: UserAccountToken,
  ): Promise<void> {}

  public async ownedBy(userId: string): Promise<string[]> {
    return this.members.ownedBy(userId);
  }
}
