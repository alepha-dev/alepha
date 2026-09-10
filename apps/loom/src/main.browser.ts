import { Alepha, run } from "alepha";

import { LoomWeb } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(LoomWeb);

run(alepha);
