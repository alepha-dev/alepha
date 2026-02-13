import { AlephaUI } from "@alepha/ui";
import { AlephaUIAuth } from "@alepha/ui/auth";
import { $module } from "alepha";
import { AdminRouter } from "./AdminRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { AdminRouter } from "./AdminRouter.ts";
export * from "./primitives/$uiAdmin.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 2 - beta | 0.12.0 | node, bun, workerd, browser|
 *
 * Admin panel UI components.
 *
 * **Features:**
 * - AdminLayout for admin pages
 * - AdminUsers with user list, create, details, settings, sessions, audits
 * - AdminFiles for file management
 * - AdminJobs for job monitoring
 * - AdminNotifications for notification management
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
