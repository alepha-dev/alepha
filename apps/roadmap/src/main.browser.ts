import { Alepha, run } from "alepha";
import { RoadmapWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    LOG_LEVEL: "trace",
  },
});

alepha.with(RoadmapWeb);

run(alepha);
