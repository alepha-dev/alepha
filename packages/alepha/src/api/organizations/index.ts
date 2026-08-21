import { $module } from "alepha";

import { AdminOrganizationController } from "./controllers/AdminOrganizationController.ts";
import { OrganizationService } from "./services/OrganizationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminOrganizationController.ts";
export * from "./entities/organizations.ts";
export * from "./schemas/createOrganizationSchema.ts";
export * from "./schemas/organizationQuerySchema.ts";
export * from "./schemas/organizationResourceSchema.ts";
export * from "./schemas/updateOrganizationSchema.ts";
export * from "./services/OrganizationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Organization management for multi-tenancy.
 *
 * **Features:**
 * - Admin CRUD for organizations
 * - Organization scoping via `db.organization()` on entities
 * - User with no organization = god mode (sees all resources)
 * - User with an organization = scoped to that organization
 *
 * @module alepha.api.organizations
 */
export const AlephaApiOrganizations = $module({
  name: "alepha.api.organizations",
  services: [OrganizationService, AdminOrganizationController],
});
