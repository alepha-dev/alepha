import { Alepha, run } from "alepha";

import { TotpWeb } from "./web/index.ts";

const alepha = Alepha.create();
alepha.with(TotpWeb);

run(alepha);
