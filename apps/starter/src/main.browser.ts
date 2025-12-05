import { Alepha, run } from "alepha";
import { StarterWeb } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(StarterWeb);

run(alepha);
