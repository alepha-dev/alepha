import { Alepha, run } from "alepha";
import { RoadmapWeb } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(RoadmapWeb);

run(alepha);
