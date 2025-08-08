import { $module } from "@alepha/core";
import { Db } from "../providers/Db.ts";
import Security from "../providers/Security.ts";
import ProjectApi from "./ProjectApi.ts";
import TaskApi from "./TaskApi.ts";

const RoadmapApi = $module({
	name: "roadmap.api",
	services: [Security, TaskApi, ProjectApi],
});

export default RoadmapApi;
