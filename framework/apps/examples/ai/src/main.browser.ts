import { Alepha, run } from "alepha";

import { AiExampleWeb } from "./web/index.ts";

const alepha = Alepha.create();
alepha.with(AiExampleWeb);

run(alepha);
