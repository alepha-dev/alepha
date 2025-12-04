import { $module } from "alepha";
import { I18n } from "./I18n.ts";
import { Toaster } from "./Toaster.ts";

export const RoadmapServices = $module({
  name: "roadmap.services",
  services: [Toaster, I18n],
});
