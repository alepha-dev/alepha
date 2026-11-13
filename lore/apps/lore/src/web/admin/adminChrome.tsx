import type { AdminRouterOptions } from "@alepha/ui/admin";

/**
 * Lore's admin chrome. The brand is the framework's default since #Q3570,
 * the back arrow to home and "Admin Panel" that Lore used to draw itself;
 * `defaultHiddenColumns` keeps the users table as lore has always shown it,
 * since lore does not populate `firstName` / `lastName`.
 */
export const loreAdminOptions: AdminRouterOptions = {
  pages: {
    users: {
      defaultHiddenColumns: ["firstName", "lastName"],
    },
  },
};
