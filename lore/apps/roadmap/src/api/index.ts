import { $module } from "@alepha/core";
import { ProjectApi } from "./ProjectApi.ts";
import { Db } from "./providers/Db.ts";
import { Security } from "./providers/Security.ts";
import { TaskApi } from "./TaskApi.ts";
import { UserApi } from "./UserApi.ts";

export const RoadmapApi = $module({
	name: "roadmap.api",
	services: [Security, Db, TaskApi, ProjectApi, UserApi],
});
