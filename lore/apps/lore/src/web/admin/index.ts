import { $module } from "alepha";
import { AppAdminRouter } from "./AppAdminRouter.ts";

export const LoreWebAdmin = $module({
  name: "lore.web.admin",
  services: [AppAdminRouter],
});
