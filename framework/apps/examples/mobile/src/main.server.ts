import { AlephaCapacitorOtaApi } from "@alepha/capacitor/ota-api";
import { Alepha, run } from "alepha";

import { ApiModule } from "./api/index.ts";
import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(ApiModule);
alepha.with(WebModule);
alepha.with(AlephaCapacitorOtaApi);

run(alepha);
