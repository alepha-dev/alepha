import { $module } from "alepha";
import { AppAdminRouter } from "@/web/admin/AppAdminRouter.ts";

export const RoadmapWebAdmin = $module({
  name: "roadmap.web.admin",
  services: [AppAdminRouter],
});
