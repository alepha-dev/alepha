import { $module } from "@alepha/core";
import { I18n } from "./I18n.ts";
import { Level } from "./Level.ts";
import { Theme } from "./Theme.ts";
import Toaster from "./Toast.ts";

export const RoadmapServices = $module({
	name: "roadmap.services",
	services: [Toaster, I18n, Theme, Level],
});
