import { AlephaUI } from "@alepha/ui";
import { AlephaUIAuth } from "@alepha/ui/auth";
import { $module } from "alepha";
import { AdminRouter } from "./AdminRouter.tsx";

// ---------------------------------------------------------------------------------------------------------------------

export { AdminRouter } from "./AdminRouter.tsx";
export * from "./primitives/$uiAdmin.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Admin panel UI components.
 *
 * **Features:**
 * - AdminLayout for admin pages
 * - AdminUsers with user list, create, details, settings, sessions, audits
 * - AdminFiles for file management
 * - AdminJobs for job monitoring

 * - AdminParameters for configuration management
 * - AdminSessions for session management
 * - AdminAudits for audit log viewing
 * - AdminVerifications for verification management
 *
 * @module alepha.ui.admin
 */
export const AlephaUIAdmin = $module({
  name: "alepha.ui.admin",
  services: [AlephaUI, AlephaUIAuth, AdminRouter],
  register: (alepha) => {
    alepha.with(AdminRouter);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
