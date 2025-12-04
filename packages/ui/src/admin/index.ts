import { AlephaUI } from "@alepha/ui";
import { AlephaUIAuth } from "@alepha/ui/auth";
import { $module } from "alepha";
import { AdminRouter } from "./AdminRouter.ts";
import { AdminSidebar } from "./AdminSidebar.ts";
import { MainRouter } from "./MainRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { AdminRouter } from "./AdminRouter.ts";
export { AdminSidebar } from "./AdminSidebar.ts";
export { default as AdminFiles } from "./components/AdminFiles.tsx";
export { default as AdminJobs } from "./components/AdminJobs.tsx";
export { default as AdminLayout } from "./components/AdminLayout.tsx";
export { default as AdminNotifications } from "./components/AdminNotifications.tsx";
export { default as AdminParameters } from "./components/AdminParameters.tsx";
export { default as AdminSessions } from "./components/AdminSessions.tsx";
export { default as AdminUserCreate } from "./components/AdminUserCreate.tsx";
export { default as AdminUserDetails } from "./components/AdminUserDetails.tsx";
export { default as AdminUserLayout } from "./components/AdminUserLayout.tsx";
export { default as AdminUserSessions } from "./components/AdminUserSessions.tsx";
export { default as AdminUserSettings } from "./components/AdminUserSettings.tsx";
export { default as AdminUsers } from "./components/AdminUsers.tsx";
export { default as AdminVerifications } from "./components/AdminVerifications.tsx";
export { MainRouter } from "./MainRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Admin panel UI Module
 *
 * @module alepha.ui.admin
 */
export const AlephaUIAdmin = $module({
  name: "alepha.ui.admin",
  services: [AlephaUI, AlephaUIAuth, AdminRouter, MainRouter, AdminSidebar],
  register: (alepha) => {
    alepha.with(AdminRouter);
    alepha.with(AdminSidebar);
  },
});
