import { AdminRouter } from "@alepha/ui/components/admin/admin-router";
import { $module } from "alepha";

export const LoreWebAdmin = $module({
  name: "lore.web.admin",
  services: [AdminRouter],
});
