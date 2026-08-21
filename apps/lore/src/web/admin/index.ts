import { AdminRouter } from "@alepha/ui/components/admin/admin-router";
import { $module } from "alepha";

import { LoreAdminRouter } from "./LoreAdminRouter.tsx";

export const LoreWebAdmin = $module({
  name: "lore.web.admin",
  /*
   * `AdminRouter` is listed even though `LoreAdminRouter`'s `$pageAdmin`
   * calls register it anyway. The redundancy is deliberate: an app's module
   * should say what it mounts, rather than leaving `/admin` to appear as a
   * side effect of a page declaration two files away.
   */
  services: [AdminRouter, LoreAdminRouter],
});
