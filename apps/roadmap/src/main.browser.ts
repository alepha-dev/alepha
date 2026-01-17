import { Alepha, run } from "alepha";
import { RoadmapWebAdmin } from "./web/admin/index.ts";
import { RoadmapWebApp } from "./web/app/index.ts";

const alepha = Alepha.create();

alepha.with(RoadmapWebApp);
alepha.with(RoadmapWebAdmin);

run(alepha);
