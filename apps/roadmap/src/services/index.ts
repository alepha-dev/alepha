import { $module } from "@alepha/core";
import { CharacterInfo } from "./CharacterInfo.ts";
import { I18n } from "./I18n.ts";
import { Toaster } from "./Toaster.ts";

export const RoadmapServices = $module({
	name: "roadmap.services",
	services: [Toaster, I18n, CharacterInfo],
});
