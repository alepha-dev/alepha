import { AlephaUI } from "@alepha/ui";
import { AlephaUIAuth } from "@alepha/ui/auth";
import { $module } from "alepha";
import { AdminRouter } from "./AdminRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { AdminRouter } from "./AdminRouter.ts";
export { default as AdminFiles } from "./components/AdminFiles.tsx";
// export { default as AdminJobs } from "./components/AdminJobs.tsx";
// export { default as AdminLayout } from "./components/AdminLayout.tsx";
// export { default as AdminNotifications } from "./components/AdminNotifications.tsx";
// export { default as AdminParameters } from "./components/AdminParameters.tsx";
// export type { AdminSessionsProps } from "./components/AdminSessions.tsx";
// export { default as AdminSessions } from "./components/AdminSessions.tsx";
// export type { AdminUsersProps } from "./components/AdminUsers.tsx";
// export { default as AdminUsers } from "./components/AdminUsers.tsx";
// export { default as AdminVerifications } from "./components/AdminVerifications.tsx";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Admin panel UI Module
 *
 * @module alepha.ui.admin
 */
export const AlephaUIAdmin = $module({
  name: "alepha.ui.admin",
  services: [AlephaUI, AlephaUIAuth, AdminRouter],
});
