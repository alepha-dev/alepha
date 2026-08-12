import type { AdminRouterOptions } from "@alepha/ui/components/admin/admin-router-options";
import { AdminBrand } from "./AdminBrand.tsx";

/**
 * Lore's admin chrome. The brand is the back-arrow-plus-title cluster the
 * deleted `AppAdminLayout` carried; `defaultHiddenColumns` keeps the users
 * table as lore has always shown it, since lore does not populate
 * `firstName` / `lastName`.
 */
export const loreAdminOptions: AdminRouterOptions = {
  brand: <AdminBrand />,
  pages: {
    users: {
      defaultHiddenColumns: ["firstName", "lastName"],
    },
  },
};
