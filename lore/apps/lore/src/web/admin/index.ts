import { $module } from "alepha";
import { AppAdminRouter } from "./AppAdminRouter.tsx";

export const LoreWebAdmin = $module({
  name: "lore.web.admin",
  services: [AppAdminRouter],
});
