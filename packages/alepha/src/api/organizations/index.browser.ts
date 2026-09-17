import { $module } from "alepha";

export type { AdminOrganizationController } from "./controllers/AdminOrganizationController.ts";
export type { MemberController } from "./controllers/MemberController.ts";
export type { OrganizationController } from "./controllers/OrganizationController.ts";
export type { OrganizationRankController } from "./controllers/OrganizationRankController.ts";
export * from "./entities/organizationMembers.ts";
export * from "./entities/organizations.ts";
export * from "./entities/organizationRanks.ts";
export * from "./schemas/organizationRankResourceSchema.ts";
export * from "./schemas/createOrganizationSchema.ts";
export * from "./schemas/updateOrganizationSchema.ts";

export const AlephaApiOrganizations = $module({
  name: "alepha.api.organizations",
  services: [],
});
