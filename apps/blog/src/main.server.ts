import { Alepha, run } from "alepha";
import { AlephaDevtools } from "alepha/devtools";
import { ApiModule } from "./api/index.ts";
import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();

if (!alepha.isProduction()) {
  alepha.with(AlephaDevtools);
}

alepha.with(WebModule);
alepha.with(ApiModule);

run(alepha);
