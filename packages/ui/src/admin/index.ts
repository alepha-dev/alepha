import { AlephaUI } from "@alepha/ui";
import { AlephaUIAuth } from "@alepha/ui/auth";
import { $module } from "alepha";
import { AdminRouter } from "./AdminRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { AdminRouter } from "./AdminRouter.ts";
// Audits
export { default as AdminAudits } from "./components/audits/AdminAudits.tsx";
// Files
export { default as AdminFiles } from "./components/files/AdminFiles.tsx";
// Jobs
export { default as AdminJobDashboard } from "./components/jobs/AdminJobDashboard.tsx";
export { default as AdminJobExecutions } from "./components/jobs/AdminJobExecutions.tsx";
export { default as AdminJobRegistry } from "./components/jobs/AdminJobRegistry.tsx";
// API Keys
export { default as AdminApiKeys } from "./components/keys/AdminApiKeys.tsx";
// Notifications
export { default as AdminNotifications } from "./components/notifications/AdminNotifications.tsx";
// Parameters
export { default as AdminParameters } from "./components/parameters/AdminParameters.tsx";
// Sessions
export { default as AdminSessions } from "./components/sessions/AdminSessions.tsx";
// Users
export { default as AdminUserAudits } from "./components/users/AdminUserAudits.tsx";
export { default as AdminUserCreate } from "./components/users/AdminUserCreate.tsx";
export { default as AdminUserDetails } from "./components/users/AdminUserDetails.tsx";
export { default as AdminUserLayout } from "./components/users/AdminUserLayout.tsx";
export { default as AdminUserSessions } from "./components/users/AdminUserSessions.tsx";
export { default as AdminUserSettings } from "./components/users/AdminUserSettings.tsx";
export { default as AdminUsers } from "./components/users/AdminUsers.tsx";
// Verifications
export { default as AdminVerifications } from "./components/verifications/AdminVerifications.tsx";
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
