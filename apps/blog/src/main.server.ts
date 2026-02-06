import { Alepha, run } from "alepha";
import { ApiModule } from "./api/index.ts";
import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(WebModule);
alepha.with(ApiModule);

run(alepha);
