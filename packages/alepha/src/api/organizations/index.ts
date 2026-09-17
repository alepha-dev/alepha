import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaApiVerification } from "alepha/api/verifications";
import { AlephaSecurity, ResourceGrantsProvider } from "alepha/security";

import { currentOrganizationRankAtom } from "./atoms/currentOrganizationRankAtom.ts";
import { AdminOrganizationController } from "./controllers/AdminOrganizationController.ts";
import { AdminOrganizationInvitationController } from "./controllers/AdminOrganizationInvitationController.ts";
import { MemberController } from "./controllers/MemberController.ts";
import { OrganizationController } from "./controllers/OrganizationController.ts";
import { OrganizationInvitationController } from "./controllers/OrganizationInvitationController.ts";
import { OrganizationRankController } from "./controllers/OrganizationRankController.ts";
import type { OrganizationInvitation } from "./entities/organizationInvitations.ts";
import { OrganizationUserHooks } from "./hooks/OrganizationUserHooks.ts";
import { OrganizationInvitationJobs } from "./jobs/OrganizationInvitationJobs.ts";
import { OrganizationPolicyProvider } from "./providers/OrganizationPolicyProvider.ts";
import { RankGrantsProvider } from "./providers/RankGrantsProvider.ts";
import { OrganizationPermissions } from "./security/OrganizationPermissions.ts";
import { InvitationRegistrationService } from "./services/InvitationRegistrationService.ts";
import { InvitationService } from "./services/InvitationService.ts";
import { InvitationTokenService } from "./services/InvitationTokenService.ts";
import { MemberService } from "./services/MemberService.ts";
import { OrganizationService } from "./services/OrganizationService.ts";
import { RankService } from "./services/RankService.ts";

export * from "./atoms/organizationConfigAtom.ts";
export * from "./atoms/currentOrganizationRankAtom.ts";
export * from "./controllers/AdminOrganizationController.ts";
export * from "./controllers/AdminOrganizationInvitationController.ts";
export * from "./controllers/MemberController.ts";
export * from "./controllers/OrganizationController.ts";
export * from "./controllers/OrganizationInvitationController.ts";
export * from "./controllers/OrganizationRankController.ts";
export * from "./entities/organizationMembers.ts";
export * from "./entities/organizationInvitations.ts";
export * from "./entities/organizations.ts";
export * from "./entities/organizationRanks.ts";
export * from "./hooks/OrganizationUserHooks.ts";
export * from "./jobs/OrganizationInvitationJobs.ts";
export * from "./providers/OrganizationPolicyProvider.ts";
export * from "./providers/RankGrantsProvider.ts";
export * from "./schemas/createOrganizationSchema.ts";
export * from "./schemas/updateOrganizationSchema.ts";
export * from "./schemas/organizationRankResourceSchema.ts";
export * from "./schemas/organizationInvitationStatusSchema.ts";
export * from "./security/$ownsOrganization.ts";
export * from "./security/OrganizationPermissions.ts";
export * from "./services/MemberService.ts";
export * from "./services/InvitationRegistrationService.ts";
export * from "./services/InvitationService.ts";
export * from "./services/InvitationTokenService.ts";
export * from "./services/OrganizationService.ts";
export * from "./services/RankService.ts";

/**
 * Organizations, membership, ownership, ranks, and invitations.
 *
 * @module alepha.api.organizations
 */
export const AlephaApiOrganizations = $module({
  name: "alepha.api.organizations",
  imports: [
    AlephaApiUsers,
    AlephaApiVerification,
    AlephaApiJobs,
    AlephaSecurity,
  ],
  services: [
    OrganizationPolicyProvider,
    MemberService,
    OrganizationService,
    InvitationTokenService,
    InvitationService,
    InvitationRegistrationService,
    RankService,
    OrganizationPermissions,
    OrganizationUserHooks,
    OrganizationController,
    OrganizationInvitationController,
    MemberController,
    OrganizationRankController,
    AdminOrganizationController,
    AdminOrganizationInvitationController,
    OrganizationInvitationJobs,
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
    "organization:invitation:created": {
      invitation: OrganizationInvitation;
      inviter: { id: string; email?: string };
      token: string;
    };
    "organization:invitation:accepted": {
      invitation: OrganizationInvitation;
      acceptedBy: { id: string; email?: string };
    };
    "organization:invitation:declined": {
      invitation: OrganizationInvitation;
      declinedBy: { id: string; email?: string };
    };
    "organization:invitation:expired": {
      invitation: OrganizationInvitation;
    };
    "organization:invitation:revoked": {
      invitation: OrganizationInvitation;
      revokedBy: { id: string };
    };
  }
}
