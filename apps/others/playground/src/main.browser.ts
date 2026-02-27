import { Alepha, run } from "alepha";
import { PlaygroundWeb } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(PlaygroundWeb);

run(alepha);
