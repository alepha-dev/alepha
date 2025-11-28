import { $module } from "alepha";
import { AlephaUI } from "../core";
import { AdminRouter } from "./AdminRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { AdminRouter } from "./AdminRouter.ts";
export { default as AdminLayout } from "./components/AdminLayout.tsx";
export type { AdminUsersProps } from "./components/AdminUsers.tsx";
export { default as AdminUsers } from "./components/AdminUsers.tsx";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Admin panel UI Module
 *
 * @module alepha.ui.admin
 */
export const AlephaUIAdmin = $module({
  name: "alepha.ui.admin",
  services: [AlephaUI, AdminRouter],
});
