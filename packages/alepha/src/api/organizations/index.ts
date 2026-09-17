import { $module } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaSecurity, ResourceGrantsProvider } from "alepha/security";

import { currentOrganizationRankAtom } from "./atoms/currentOrganizationRankAtom.ts";
import { AdminOrganizationController } from "./controllers/AdminOrganizationController.ts";
import { MemberController } from "./controllers/MemberController.ts";
import { OrganizationController } from "./controllers/OrganizationController.ts";
import { OrganizationRankController } from "./controllers/OrganizationRankController.ts";
import { OrganizationUserHooks } from "./hooks/OrganizationUserHooks.ts";
import { OrganizationPolicyProvider } from "./providers/OrganizationPolicyProvider.ts";
import { RankGrantsProvider } from "./providers/RankGrantsProvider.ts";
import { OrganizationPermissions } from "./security/OrganizationPermissions.ts";
import { MemberService } from "./services/MemberService.ts";
import { OrganizationService } from "./services/OrganizationService.ts";
import { RankService } from "./services/RankService.ts";

export * from "./atoms/organizationConfigAtom.ts";
export * from "./atoms/currentOrganizationRankAtom.ts";
export * from "./controllers/AdminOrganizationController.ts";
export * from "./controllers/MemberController.ts";
export * from "./controllers/OrganizationController.ts";
export * from "./controllers/OrganizationRankController.ts";
export * from "./entities/organizationMembers.ts";
export * from "./entities/organizations.ts";
export * from "./entities/organizationRanks.ts";
export * from "./hooks/OrganizationUserHooks.ts";
export * from "./providers/OrganizationPolicyProvider.ts";
export * from "./providers/RankGrantsProvider.ts";
export * from "./schemas/createOrganizationSchema.ts";
export * from "./schemas/updateOrganizationSchema.ts";
export * from "./schemas/organizationRankResourceSchema.ts";
export * from "./security/$ownsOrganization.ts";
export * from "./security/OrganizationPermissions.ts";
export * from "./services/MemberService.ts";
export * from "./services/OrganizationService.ts";
export * from "./services/RankService.ts";

/**
 * Organizations, membership, ownership, ranks, and invitations.
 *
 * @module alepha.api.organizations
 */
export const AlephaApiOrganizations = $module({
  name: "alepha.api.organizations",
  imports: [AlephaApiUsers, AlephaSecurity],
  services: [
    OrganizationPolicyProvider,
    MemberService,
    OrganizationService,
    RankService,
    OrganizationPermissions,
    OrganizationUserHooks,
    OrganizationController,
    MemberController,
    OrganizationRankController,
    AdminOrganizationController,
  ],
  atoms: [currentOrganizationRankAtom],
  register: (alepha) => {
    alepha.with({
      provide: ResourceGrantsProvider,
      use: RankGrantsProvider,
    });
  },
});

declare module "alepha" {
  interface Hooks {
    "organization:member:removed": {
      organizationId: string;
      userId: string;
      actor: { id: string };
      leave: boolean;
    };
    "organization:ownership:transferred": {
      organizationId: string;
      fromUserId: string;
      toUserId: string;
    };
  }
}
