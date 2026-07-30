import { Alepha, run } from "alepha";
import { BayUiWeb } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(BayUiWeb);

run(alepha);
