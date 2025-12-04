import { Alepha, run } from "alepha";
import { ExampleSaasWeb } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(ExampleSaasWeb);

run(alepha);
