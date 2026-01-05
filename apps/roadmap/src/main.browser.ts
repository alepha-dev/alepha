import { Alepha, run } from "alepha";
import { RoadmapAdm } from "./adm/index.ts";
import { RoadmapWeb } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(RoadmapWeb);
alepha.with(RoadmapAdm);

run(alepha);
