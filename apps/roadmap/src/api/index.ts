import { $module } from "@alepha/core";
import { CharacterApi } from "./CharacterApi.ts";
import { IdentityApi } from "./IdentityApi.ts";
import { ProjectApi } from "./ProjectApi.ts";
import { ProjectStatsApi } from "./ProjectStatsApi.ts";
import { Db } from "./providers/Db.ts";
import { Security } from "./providers/Security.ts";
import { SessionApi } from "./SessionApi.ts";
import { TaskApi } from "./TaskApi.ts";
import { UserApi } from "./UserApi.ts";

export const RoadmapApi = $module({
	name: "roadmap.api",
	services: [Security, Db, TaskApi, ProjectApi, UserApi, SessionApi, CharacterApi, IdentityApi, ProjectStatsApi],
});
