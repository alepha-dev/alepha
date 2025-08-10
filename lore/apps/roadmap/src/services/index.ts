import { $module } from "@alepha/core";
import { I18n } from "./I18n.ts";
import { Level } from "./Level.ts";
import { Theme } from "./Theme.ts";
import Toast from "./Toast.ts";

const RoadmapServices = $module({
	name: "roadmap.services",
	services: [Toast, I18n, Theme, Level],
});

export default RoadmapServices;
