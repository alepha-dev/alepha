import { Alepha, run } from "alepha";
import { PulseWeb } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(PulseWeb);

run(alepha);
