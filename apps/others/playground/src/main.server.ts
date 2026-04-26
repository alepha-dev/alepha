import { Alepha, run } from "alepha";
import { PlaygroundApi } from "./api/index.ts";
import { PlaygroundWeb } from "./web/index.ts";

const alepha = Alepha.create();
alepha.with(PlaygroundApi);
alepha.with(PlaygroundWeb);

run(alepha);
