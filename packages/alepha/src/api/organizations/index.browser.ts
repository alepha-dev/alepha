import { $module } from "alepha";

export type { AdminOrganizationController } from "./controllers/AdminOrganizationController.ts";
export type { AdminOrganizationInvitationController } from "./controllers/AdminOrganizationInvitationController.ts";
export type { MemberController } from "./controllers/MemberController.ts";
export type { OrganizationController } from "./controllers/OrganizationController.ts";
export type { OrganizationInvitationController } from "./controllers/OrganizationInvitationController.ts";
export type { OrganizationRankController } from "./controllers/OrganizationRankController.ts";
export * from "./entities/organizationMembers.ts";
export * from "./entities/organizationInvitations.ts";
export * from "./entities/organizations.ts";
export * from "./entities/organizationRanks.ts";
export * from "./schemas/organizationRankResourceSchema.ts";
export * from "./schemas/organizationSummaryResourceSchema.ts";
export * from "./schemas/organizationInvitationStatusSchema.ts";
export * from "./schemas/createOrganizationSchema.ts";
export * from "./schemas/updateOrganizationSchema.ts";

export const AlephaApiOrganizations = $module({
  name: "alepha.api.organizations",
  services: [],
});
